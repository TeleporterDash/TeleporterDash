import { applyVisualEffects, updateVisualEffects, EffectManager } from "./visualEffectsEngine.js";
import { getLayerOrder } from "./layerManager.js";
import { getSprite, getPlayerSprite, getFloorSprite } from "./spriteManager.js";
import { isObjectActive } from "./groupManager.js";
import { updateAnimations, pregenerateTextures, clearTextureCache, getTextureCache } from "./animationEngine.js";
import { hexToNumber } from "./colorUtils.js";
import { warn, error, debug, verbose, setLogLevel } from "./logManager.js";
import { map, flatMap, filter } from "lodash";

setLogLevel("debug");

export class RenderEngine {
  constructor(pixiApp, blockSize) {
    this.pixiApp = pixiApp;
    this.blockSize = blockSize;
    this.container = new window.PIXI.Container();
    this.container.sortableChildren = true;
    this.pixiApp.stage.addChild(this.container);
    this.blockSprites = [];
    this.playerSprite = null;
    this.floorSprite = null;
    this.tickerCallback = null;
    this.matrix = null;
    this.spriteMap = null;
    this.cameraManager = null;
    this.levelCompleteHandler = null;
    this.isLevelComplete = false;
    this.audioManager = null;
    this.isPaused = false;
    this.lastUpdateTime = 0;
    this.pausedTime = 0;
    this.wasDead = false;
    this.effectManager = new EffectManager();
    this.particleSystem = this.effectManager.createParticleSystem("main", this.container, {
      maxParticles: 500,
      poolSize: 100,
      zIndex: 10,
    });
    debug("renderEngine", "RenderEngine initialized with particle system");
  }

  /**
   * Clean up sprites and their particle containers
   * @param {PIXI.Sprite[]} sprites - Array of sprites to clean up
   * @param {Object} options - Destruction options
   */
  cleanupSprites(sprites, options = { children: false, texture: false, baseTexture: false }) {
    map(sprites, (sprite) => {
      try {
        if (sprite.particleContainer && sprite.particleContainer.parent) {
          sprite.particleContainer.parent.removeChild(sprite.particleContainer);
          sprite.particleContainer.destroy({ children: true });
        }
        if (sprite.parent) {
          sprite.parent.removeChild(sprite);
        }
        if (sprite.filters && Array.isArray(sprite.filters)) {
          sprite.filters = null;
        }
        sprite.destroy(options);
      } catch (err) {
        error("renderEngine", "Error cleaning up sprite:", err);
      }
    });
    return [];
  }

  /**
   * Initialize object appearance properties
   * @param {Object} object - Game object
   */
  initializeAppearance(object) {
    object.appearance = object.appearance || {};
    object.appearance.color = object.appearance.color || {};
    return {
      colorShiftRate: Number.parseFloat(object.appearance.color?.shiftRate) || 0,
      colorPulse: object.appearance.color?.pulseColor || "0",
      colorPulseRate: Number.parseFloat(object.appearance.color?.pulseRate) || 0,
      baseColor: object.appearance.color?.base || "#888",
      tintColor: object.appearance.color?.tint || "0",
      tintIntensity: Number.parseFloat(object.appearance.color?.tintIntensity) || 0,
      svg: this.spriteMap.get(String(object.type))?.svg,
      effectType: object.appearance?.effectType || "none",
      effectIntensity: Number.parseFloat(object.appearance?.effectIntensity) || 1,
      effectSpeed: Number.parseFloat(object.appearance?.effectSpeed) || 1,
    };
  }

  /**
   * Show visual feedback for modifier activation
   * @param {Object} modifier - The modifier that was activated
   */
  async showModifierActivation(modifier) {
    if (!modifier) return;
    const screenX = (modifier.x + 0.5) * this.blockSize;
    const screenY = (modifier.y + 0.5) * this.blockSize;
    await new Promise((resolve) => {
      this.particleSystem.createExplosion(
        { x: screenX, y: screenY },
        { color: "#00ffff", count: 20, maxRadius: this.blockSize * 0.8 }
      );
      setTimeout(resolve, 300);
    });
  }

  /**
   * Reset the render engine
   */
  reset() {
    this.stopGameLoop();
    this.isLevelComplete = false;
    this.resetAudio();
    this.effectManager.cleanup();
    this.blockSprites = this.cleanupSprites(this.blockSprites, { children: false, texture: false, baseTexture: false });
    if (this.playerSprite) {
      if (this.playerSprite.parent) {
        this.playerSprite.parent.removeChild(this.playerSprite);
      }
      this.playerSprite.destroy({ children: false, texture: false, baseTexture: false });
      this.playerSprite = null;
    }
    if (this.floorSprite) {
      if (this.floorSprite.parent) {
        this.floorSprite.parent.removeChild(this.floorSprite);
      }
      this.floorSprite.destroy({ children: false, texture: false, baseTexture: false });
      this.floorSprite = null;
    }
    clearTextureCache();
    this.container.x = 0;
    this.container.y = 0;
    this.effectManager = new EffectManager();
    this.particleSystem = this.effectManager.createParticleSystem("main", this.container, {
      maxParticles: 500,
      poolSize: 100,
      zIndex: 10,
    });
    debug("renderEngine", "Reset complete - textures preserved for reuse");
  }

  /**
   * Render the game matrix
   * @param {Array} matrix - Game matrix
   * @param {Map} spriteMap - Sprite map
   */
  async renderMatrix(matrix, spriteMap) {
    this.matrix = matrix;
    this.spriteMap = spriteMap;
    this.blockSprites = this.cleanupSprites(this.blockSprites, { children: true });
    const textureAssets = [];
    debug("renderEngine", "Starting texture and effect initialization");

    const objects = flatMap(matrix, (row, y) =>
      map(row, (object, x) => ({ object, x, y }))
    ).filter(({ object }) => object && isObjectActive(object) && object.type !== 0);

    map(objects, ({ object, x, y }) => {
      Object.assign(object, this.initializeAppearance(object));
      pregenerateTextures(object, x, y);
    });

    const cache = getTextureCache();
    for (const [cacheKey, { src }] of cache.entries()) {
      textureAssets.push({ alias: cacheKey, src });
    }
    if (textureAssets.length > 0) {
      await window.PIXI.Assets.load(textureAssets);
      for (const { alias } of textureAssets) {
        cache.set(alias, window.PIXI.Assets.get(alias));
      }
      debug("renderEngine", "Preloaded animation textures:", map(textureAssets, "alias"));
    }

    await this.renderFloor();

    const blocks = map(getLayerOrder(matrix), ({ object, x, y }) => ({
      object,
      x: x * this.blockSize + this.blockSize / 2,
      y: y * this.blockSize + this.blockSize / 2,
    }));

    for (const { object, x, y } of blocks) {
      if (!object || !isObjectActive(object)) continue;
      let sprite;
      if (object.isModifier && object.modifierType) {
        sprite = await getSprite(object.modifierType, spriteMap, { skipColorize: true });
        if (!sprite) {
          sprite = new window.PIXI.Graphics()
            .circle(0, 0, this.blockSize * 0.4)
            .fill({ color: 0x8888ff, alpha: 0.7 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
          const text = new window.PIXI.Text(String(object.modifierType - 20), {
            fontFamily: "Arial",
            fontSize: this.blockSize * 0.4,
            fill: 0xffffff,
            align: "center",
          });
          text.anchor.set(0.5);
          sprite.addChild(text);
        }
      } else {
        sprite = await getSprite(object.type, spriteMap, object.appearance?.color || { base: "#888", tint: "0", tintIntensity: 0 });
        if (!sprite) {
          warn("renderEngine", `No sprite for block type ${object.type} at [${x / this.blockSize},${y / this.blockSize}]`);
          sprite = new window.PIXI.Graphics()
            .rect(-this.blockSize / 2, -this.blockSize / 2, this.blockSize, this.blockSize)
            .fill({ color: hexToNumber(object.appearance?.color?.base || "#888") });
        }
      }

      sprite.x = x;
      sprite.y = y;
      sprite.rotation = (object.transform?.rotation * Math.PI) / 180 || 0;
      sprite.scale.set(
        (object.transform?.scale || 1) * (object.transform?.flip === "h" || object.transform?.flip === "hv" ? -1 : 1),
        (object.transform?.scale || 1) * (object.transform?.flip === "v" || object.transform?.flip === "hv" ? -1 : 1)
      );
      sprite.alpha = Number.parseFloat(object.appearance?.opacity) || 1;
      sprite.zIndex = Number.parseFloat(object.appearance?.depthOffset || 0) + Number.parseFloat(object.layer || 0) * 1000;
      sprite.animation = object.animation || { pulseRate: 0, pulseAmplitude: 0, syncType: "0" };
      sprite.blockData = object;

      applyVisualEffects(sprite, object.appearance, this.effectManager);

      this.container.addChild(sprite);
      this.blockSprites.push(sprite);
      verbose("renderEngine", `Rendered sprite type ${object.type} at [${x / this.blockSize - 0.5},${y / this.blockSize - 0.5}] with opacity ${sprite.alpha}, zIndex ${sprite.zIndex}`);
    }
  }

  /**
   * Set sprite transform properties
   * @param {PIXI.Sprite} sprite - Sprite to transform
   * @param {Object} data - Position and transformation data
   * @param {Object} options - Additional options
   */
  setSpriteTransform(sprite, data, options = {}) {
    const { xOffset = 0.5, yOffset = 0.5 } = options;
    sprite.x = (data.x + xOffset) * this.blockSize;
    sprite.y = (data.y + yOffset) * this.blockSize;
    sprite.scale.x = Math.abs(sprite.scale.x) * (data.facing || 1);
    sprite.scale.y = Math.abs(sprite.scale.y);
    sprite.rotation = ((data.rotation || 0) * Math.PI) / 180;
  }

  /**
   * Render the floor sprite
   */
  async renderFloor() {
    debug("renderEngine", "Rendering floor...");
    if (this.floorSprite) {
      if (this.floorSprite.parent) {
        this.floorSprite.parent.removeChild(this.floorSprite);
      }
      this.floorSprite.destroy();
      this.floorSprite = null;
    }
    if (!this.spriteMap) {
      error("renderEngine", "Cannot render floor: spriteMap not initialized");
      return;
    }
    try {
      this.floorSprite = await getFloorSprite(this.spriteMap);
      this.floorSprite.width = this.pixiApp.screen.width * 5;
      this.floorSprite.height = this.blockSize;
      this.floorSprite.zIndex = -10;
      this.isFloorInitialized = true;
      this.updateFloorPosition();
      this.container.addChild(this.floorSprite);
      verbose("renderEngine", "Floor rendered successfully", {
        width: this.floorSprite.width,
        height: this.floorSprite.height,
        x: this.floorSprite.x,
        y: this.floorSprite.y,
      });
    } catch (err) {
      error("renderEngine", "Error rendering floor:", err);
    }
  }

  /**
   * Update floor position to follow camera
   */
  updateFloorPosition() {
    if (!this.floorSprite || !window.cameraManager) return;
    const FLOOR_CONFIG = {
      WIDTH_MULTIPLIER: 5,
      Y_OFFSET: -2.25,
    };
    this.floorSprite.x = (window.cameraManager.x || 0) - this.pixiApp.screen.width * 2;
    this.floorSprite.y = this.pixiApp.screen.height + this.blockSize * FLOOR_CONFIG.Y_OFFSET;
  }

  /**
   * Re-render matrix and restore player position
   * @param {Object} player - Player instance
   * @param {Object} playerPos - Position to restore
   */
  async reRenderMatrix(player, playerPos) {
    if (!playerPos || !player || !this.matrix || !this.spriteMap) {
      warn("renderEngine", "reRenderMatrix called without required arguments");
      return;
    }
    try {
      const prevX = player.x;
      const prevY = player.y;
      await this.renderFloor();
      await this.renderMatrix(this.matrix, this.spriteMap);
      player.x = playerPos.x;
      player.y = playerPos.y;
      if (prevX !== player.x || prevY !== player.y) {
        await this.renderPlayer(player);
      }
      if (window.cameraManager) {
        window.cameraManager.setPosition(player.x, player.y);
      }
      debug("renderEngine", "Matrix re-rendered and player position restored");
    } catch (err) {
      error("renderEngine", "Error in reRenderMatrix:", err);
    }
  }

  /**
   * Render the player sprite
   * @param {Object} player - Player instance
   */
  async renderPlayer(player) {
    if (this.playerSprite) {
      if (this.playerSprite.parent) {
        this.container.removeChild(this.playerSprite);
      }
      this.playerSprite.destroy();
      this.playerSprite = null;
    }
    this.playerSprite = await getPlayerSprite(this.spriteMap);
    this.playerSprite.zIndex = 10000;
    const spriteSize = 30;
    this.playerSprite.scale.set(this.blockSize / spriteSize);
    this.setSpriteTransform(this.playerSprite, player, { xOffset: 0.5, yOffset: 0.75 });
    this.container.addChild(this.playerSprite);
    debug("renderEngine", "Player sprite rendered successfully");
    verbose("renderEngine", `Player sprite updated at [${player.x},${player.y}] with scale ${this.playerSprite.scale.x}, rotation ${player.rotation}`);
  }

  /**
   * Start the game loop
   * @param {Object} player - Player instance
   * @param {Object} physics - Physics engine
   */
  startGameLoop(player, physics) {
    let lastTime = performance.now();
    this.tickerCallback = (delta) => {
      const currentTime = performance.now();
      const deltaTimeSeconds = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      verbose("renderEngine", "Ticker running, delta:", deltaTimeSeconds);
      physics.update();
      this.updatePlayerPosition(player, player.rotation);
      if (!this.isPaused) {
        updateVisualEffects(this.blockSprites, deltaTimeSeconds, this.effectManager);
        map(this.blockSprites, (sprite) => {
          const effectType = sprite.blockData?.appearance?.effectType;
          if (effectType && effectType !== "none") {
            const intensity = Number.parseFloat(sprite.blockData.appearance.effectIntensity) || 1;
            this.particleSystem.emit(sprite, effectType, intensity);
          }
        });
      }
      if (window.cameraManager && player) {
        const playerX = player.x * this.blockSize;
        const playerY = player.y * this.blockSize;
        window.cameraManager.follow({ x: playerX, y: playerY }, 0, -this.pixiApp.canvas.height * 0.2);
        window.cameraManager.update();
      }
      if (this.isFloorInitialized) {
        this.updateFloorPosition();
        verbose("renderEngine", "Updated floor position:", this.floorSprite.x, this.floorSprite.y);
      }
      if (!this.matrix || !this.blockSprites) {
        warn("renderEngine", "Cannot update animations: matrix or sprites not initialized");
        return;
      }
      try {
        updateAnimations(this.matrix, delta, this.blockSprites);
      } catch (err) {
        error("renderEngine", "Error updating animations:", err);
      }
      if (physics.isDead && !this.wasDead) {
        debug("renderEngine", "Player died!");
        this.wasDead = true;
      } else if (!physics.isDead) {
        this.wasDead = false;
      }
      if (physics.isComplete && !this.isLevelComplete) {
        debug("renderEngine", "Level complete! Initiating level complete sequence");
        this.handleLevelComplete();
      }
    };
    this.pixiApp.ticker.add(this.tickerCallback);
    debug("renderEngine", "Game loop started");
  }

  /**
   * Update player sprite position and rotation
   * @param {Object} player - Player instance
   * @param {number} rotation - Rotation in degrees
   */
  updatePlayerPosition(player, rotation) {
    if (!this.playerSprite) return;
    this.setSpriteTransform(this.playerSprite, { ...player, rotation }, { xOffset: 0.5, yOffset: 0.75 });
    verbose("renderEngine", `Player position updated: x=${player.x}, y=${player.y}, visualY=${player.y + 0.75}, rotation=${rotation || player.rotation || 0}`);
  }

  /**
   * Stop the game loop
   */
  stopGameLoop() {
    if (this.tickerCallback) {
      this.pixiApp.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
      debug("renderEngine", "Game loop stopped");
    }
  }

  /**
   * Set pause state
   * @param {boolean} isPaused - Pause or resume
   */
  setPaused(isPaused) {
    this.isPaused = isPaused;
    if (isPaused) {
      this.pausedTime = Date.now();
      this.effectManager.pauseAll();
    } else {
      const now = Date.now();
      this.lastUpdateTime += now - this.pausedTime;
      this.effectManager.resumeAll();
    }
  }

  /**
   * Update the render engine
   * @param {number} deltaTime - Time since last update
   */
  update(deltaTime) {
    if (this.isPaused) return;
    const now = Date.now();
    deltaTime = now - this.lastUpdateTime;
    this.lastUpdateTime = now;
    if (window.physicsEngine) window.physicsEngine.update(deltaTime);
    if (window.cameraManager) window.cameraManager.update(deltaTime);
    if (this.isFloorInitialized) this.updateFloorPosition();
    this.effectManager.update(deltaTime);
  }

  /**
   * Handle level completion
   */
  handleLevelComplete() {
    if (this.isLevelComplete) return;
    this.isLevelComplete = true;
    debug("renderEngine", "Handling level completion");
    this.fadeOutAudio();
    this.stopGameLoop();
    this.createLevelCompleteUI();
    const levelCompleteElement = document.getElementById("levelComplete");
    if (levelCompleteElement) {
      levelCompleteElement.style.display = "block";
      levelCompleteElement.style.opacity = 0;
      let opacity = 0;
      const fadeInterval = setInterval(() => {
        opacity += 0.15;
        levelCompleteElement.style.opacity = opacity;
        if (opacity >= 1) clearInterval(fadeInterval);
      }, 15);
    }
  }

  /**
   * Create level complete UI
   */
  createLevelCompleteUI() {
    debug("renderEngine", "Creating level complete UI");
    if (document.getElementById("levelComplete")) return;
    const levelCompleteElement = document.createElement("div");
    levelCompleteElement.id = "levelComplete";
    levelCompleteElement.innerHTML = `
      <style>
        #levelComplete {
          position: fixed;
          top: 40%;
          left: 50%;
          transform: translate(-50%, 0);
          background: rgba(0, 0, 0, 0.8);
          color: #00ff00;
          font-size: 48px;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
          z-index: 9999;
          display: none;
        }
        #nextLevelBtn, #menuBtn {
          background: #4285F4;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          margin: 10px;
          cursor: pointer;
        }
      </style>
      Level Complete!<br>
      <button id="nextLevelBtn">Next Level</button>
      <button id="menuBtn">Back to Menu</button>
    `;
    document.body.appendChild(levelCompleteElement);
    document.getElementById("nextLevelBtn").addEventListener("click", () => {
      const urlParams = new URLSearchParams(window.location.search);
      const currentLevel = Number.parseInt(urlParams.get("level") || "1");
      window.location.href = `?level=${currentLevel + 1}`;
    });
    document.getElementById("menuBtn").addEventListener("click", () => {
      window.location.href = "../TDMenu.html";
    });
  }

  /**
   * Set AudioManager reference
   * @param {Object} audioManager - AudioManager instance
   */
  setAudioManager(audioManager) {
    this.audioManager = audioManager;
    debug("renderEngine", "AudioManager reference set");
  }

  /**
   * Reset audio state
   */
  resetAudio() {
    if (!this.audioManager) {
      error("renderEngine", "No AudioManager available for reset");
      return;
    }
    try {
      this.audioManager.reset();
      setTimeout(() => {
        this.audioManager.playBackgroundMusic();
      }, 100);
      debug("renderEngine", "Audio reset complete");
    } catch (err) {
      error("renderEngine", "Error resetting audio:", err);
    }
  }

  /**
   * Handle audio for level completion
   */
  fadeOutAudio() {
    if (!this.audioManager) {
      debug("renderEngine", "No AudioManager found for level completion");
      return;
    }
    try {
      if (this.physics?.isComplete && this.physics?.audioManager === this.audioManager) {
        const music = this.audioManager.backgroundMusic || this.audioManager.practiceMusic;
        if (music && !music.paused) this.audioManager.fadeOut(music);
      } else {
        this.audioManager.playCompletionSound(false);
      }
    } catch (err) {
      error("renderEngine", "Error handling completion audio:", err);
    }
  }
}