import {
  applyVisualEffects,
  updateVisualEffects,
  EffectManager,
} from "./visualEffectsEngine";
import { getLayerOrder } from "./layerManager";
import { getSprite, getPlayerSprite, getFloorSprite } from "./spriteManager";
import type { SpriteMap } from "./spriteManager";
import { isObjectActive } from "./groupManager";
import {
  updateAnimations,
  pregenerateTextures,
  clearTextureCache,
  getTextureCache,
} from "./animationEngine";
import { hexToNumber } from "./colorUtils";
import { warn, error, debug, verbose, setLogLevel } from "./logManager";
import { map, flatMap, filter } from "lodash";
import {
  Container,
  Text,
  Assets,
  Sprite,
  Application,
  Texture,
  TickerCallback,
} from "pixi.js";
import type { IDestroyOptions } from "@pixi/display";

setLogLevel("debug");

type RenderTickerCallback = (delta: number) => void;

export class RenderEngine {
  pixiApp: Application;
  blockSize: number;
  container: Container;
  blockSprites: Sprite[];
  playerSprite: Sprite | null;
  floorSprite: Sprite | null;
  tickerCallback: RenderTickerCallback | null;
  matrix: any[][] | null; // Assuming 2D array of objects
  spriteMap: SpriteMap | null; // Map of sprite definitions by type
  cameraManager: any | null; // Assuming CameraManager type, adjust if available
  levelCompleteHandler: (() => void) | null;
  isLevelComplete: boolean;
  audioManager: any | null; // Assuming AudioManager type
  isPaused: boolean;
  lastUpdateTime: number;
  pausedTime: number;
  wasDead: boolean;
  effectManager: EffectManager;
  particleSystem: any; // Assuming ParticleSystem type
  isFloorInitialized: boolean;
  physics: any | null; // Assuming PhysicsEngine type

  constructor(pixiApp: Application, blockSize: number) {
    this.pixiApp = pixiApp;
    this.blockSize = blockSize;
    this.container = new Container();
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
    this.particleSystem = this.effectManager.createParticleSystem(
      "main",
      this.container,
      {
        maxParticles: 500,
        poolSize: 100,
        zIndex: 10,
      }
    );
    this.isFloorInitialized = false;
    debug("renderEngine", "RenderEngine initialized with particle system");
  }

  private static readonly DESTROY_OPTIONS: IDestroyOptions = {
    children: false,
    texture: false,
  };

  /**
   * Clean up sprites and their particle containers
   * @param {Sprite[]} sprites - Array of sprites to clean up
   * @param {any} options - Destruction options
   */
  cleanupSprites(
    sprites: Sprite[],
    options: IDestroyOptions = RenderEngine.DESTROY_OPTIONS
  ): Sprite[] {
    map(sprites, (sprite: Sprite) => {
      try {
        if (
          sprite &&
          "particleContainer" in sprite &&
          (sprite as any).particleContainer &&
          (sprite as any).particleContainer.parent
        ) {
          (sprite as any).particleContainer.parent.removeChild(
            (sprite as any).particleContainer
          );
          (sprite as any).particleContainer.destroy({ children: true });
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
   * @param {any} object - Game object
   */
  initializeAppearance(object: any): any {
    object.appearance = object.appearance || {};
    object.appearance.color = object.appearance.color || {};
    return {
      colorShiftRate:
        Number.parseFloat(object.appearance.color?.shiftRate) || 0,
      colorPulse: object.appearance.color?.pulseColor || "0",
      colorPulseRate:
        Number.parseFloat(object.appearance.color?.pulseRate) || 0,
      baseColor: object.appearance.color?.base || "#888",
      tintColor: object.appearance.color?.tint || "0",
      tintIntensity:
        Number.parseFloat(object.appearance.color?.tintIntensity) || 0,
      svg: this.spriteMap?.get(String(object.type))?.svg,
      effectType: object.appearance?.effectType || "none",
      effectIntensity:
        Number.parseFloat(object.appearance?.effectIntensity) || 1,
      effectSpeed: Number.parseFloat(object.appearance?.effectSpeed) || 1,
    };
  }

  /**
   * Show visual feedback for modifier activation
   * @param {any} modifier - The modifier that was activated
   */
  async showModifierActivation(modifier: any): Promise<void> {
    if (!modifier) return;
    const screenX = (modifier.x + 0.5) * this.blockSize;
    const screenY = (modifier.y + 0.5) * this.blockSize;
    await new Promise<void>((resolve) => {
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
  reset(): void {
    this.stopGameLoop();
    this.isLevelComplete = false;
    this.resetAudio();
    this.effectManager.cleanup();
    this.blockSprites = this.cleanupSprites(
      this.blockSprites,
      RenderEngine.DESTROY_OPTIONS
    );
    if (this.playerSprite) {
      if (this.playerSprite.parent) {
        this.playerSprite.parent.removeChild(this.playerSprite);
      }
      this.playerSprite.destroy(RenderEngine.DESTROY_OPTIONS);
      this.playerSprite = null;
    }
    if (this.floorSprite) {
      if (this.floorSprite.parent) {
        this.floorSprite.parent.removeChild(this.floorSprite);
      }
      this.floorSprite.destroy(RenderEngine.DESTROY_OPTIONS);
      this.floorSprite = null;
    }
    clearTextureCache();
    this.container.x = 0;
    this.container.y = 0;
    this.isFloorInitialized = false;
    this.effectManager = new EffectManager();
    this.particleSystem = this.effectManager.createParticleSystem(
      "main",
      this.container,
      {
        maxParticles: 500,
        poolSize: 100,
        zIndex: 10,
      }
    );
    debug("renderEngine", "Reset complete - textures preserved for reuse");
  }

  /**
   * Render the game matrix
   * @param {any[][]} matrix - Game matrix
   * @param {Map<string, any>} spriteMap - Sprite map
   */
  async renderMatrix(matrix: any[][], spriteMap: SpriteMap): Promise<void> {
    this.matrix = matrix;
    this.spriteMap = spriteMap;
    this.blockSprites = this.cleanupSprites(this.blockSprites, {
      children: true,
    });
    const textureAssets: { alias: string; src: string }[] = [];
    debug("renderEngine", "Starting texture and effect initialization");

    const objects = flatMap(matrix, (row: any[], y: number) =>
      map(row, (object: any, x: number) => ({ object, x, y }))
    ).filter(
      ({ object }: { object: any }) =>
        object && isObjectActive(object) && object.type !== 0
    );

    map(objects, ({ object, x, y }: { object: any; x: number; y: number }) => {
      Object.assign(object, this.initializeAppearance(object));
      pregenerateTextures(object, x, y);
    });

    const cache = getTextureCache();
    for (const [cacheKey, { src }] of cache.entries()) {
      textureAssets.push({ alias: cacheKey, src });
    }
    if (textureAssets.length > 0) {
      await Assets.load(textureAssets);
      for (const { alias } of textureAssets) {
        cache.set(alias, Assets.get(alias));
      }
      debug(
        "renderEngine",
        "Preloaded animation textures:",
        map(textureAssets, "alias")
      );
    }

    await this.renderFloor();

    const blocks = map(
      getLayerOrder(matrix),
      ({ object, x, y }: { object: any; x: number; y: number }) => ({
        object,
        x: x * this.blockSize + this.blockSize / 2,
        y: y * this.blockSize + this.blockSize / 2,
      })
    );

    for (const { object, x, y } of blocks) {
      if (!object || !isObjectActive(object)) continue;

      const sprite = await this.createObjectSprite(object, spriteMap);

      sprite.x = x;
      sprite.y = y;
      sprite.rotation = (object.transform?.rotation * Math.PI) / 180 || 0;
      sprite.scale.set(
        (object.transform?.scale || 1) *
          (object.transform?.flip === "h" || object.transform?.flip === "hv"
            ? -1
            : 1),
        (object.transform?.scale || 1) *
          (object.transform?.flip === "v" || object.transform?.flip === "hv"
            ? -1
            : 1)
      );
      sprite.alpha = Number.parseFloat(object.appearance?.opacity) || 1;
      sprite.zIndex =
        Number.parseFloat(object.appearance?.depthOffset || 0) +
        Number.parseFloat(object.layer || 0) * 1000;
      (sprite as any).animation = object.animation || {
        pulseRate: 0,
        pulseAmplitude: 0,
        syncType: "0",
      };
      (sprite as any).blockData = object;

      applyVisualEffects(sprite, object.appearance, this.effectManager);

      this.container.addChild(sprite);
      this.blockSprites.push(sprite);
      verbose(
        "renderEngine",
        `Rendered sprite type ${object.type} at [${x / this.blockSize - 0.5},${
          y / this.blockSize - 0.5
        }] with opacity ${sprite.alpha}, zIndex ${sprite.zIndex}`
      );
    }
  }

  private async createObjectSprite(
    object: any,
    spriteMap: SpriteMap
  ): Promise<Sprite> {
    const sprite = await getSprite(
      object.isModifier && object.modifierType
        ? object.modifierType
        : object.type,
      spriteMap,
      object.isModifier
        ? { skipColorize: true }
        : object.appearance?.color || {
            base: "#888",
            tint: "0",
            tintIntensity: 0,
          }
    );

    if (sprite) {
      sprite.anchor.set(0.5);

      if (object.isModifier && object.modifierType) {
        this.ensureModifierLabel(sprite, object.modifierType);
      }
      return sprite;
    }

    return this.createFallbackSprite(object);
  }

  private ensureModifierLabel(sprite: Sprite, modifierType: number): void {
    const existingLabel = sprite.children.find(
      (child) => child.name === "modifier-label"
    );
    if (existingLabel && existingLabel instanceof Text) {
      existingLabel.text = String(modifierType - 20);
      return;
    }

    const label = new Text(String(modifierType - 20), {
      fontFamily: "Arial",
      fontSize: this.blockSize * 0.4,
      fill: 0xffffff,
      align: "center",
    });
    label.anchor.set(0.5);
    label.name = "modifier-label";
    sprite.addChild(label);
  }

  private createFallbackSprite(object: any): Sprite {
    const sprite = new Sprite(Texture.WHITE);
    sprite.anchor.set(0.5);
    sprite.width = this.blockSize;
    sprite.height = this.blockSize;

    const baseColor = hexToNumber(object.appearance?.color?.base || "#888");
    sprite.tint = baseColor;

    if (object.isModifier && object.modifierType) {
      sprite.alpha = 0.7;
      this.ensureModifierLabel(sprite, object.modifierType);
    }

    return sprite;
  }

  /**
   * Set sprite transform properties
   * @param {Sprite} sprite - Sprite to transform
   * @param {any} data - Position and transformation data
   * @param {any} options - Additional options
   */
  setSpriteTransform(
    sprite: Sprite,
    data: any,
    options: { xOffset?: number; yOffset?: number } = {}
  ): void {
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
  async renderFloor(): Promise<void> {
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
      if (!this.floorSprite) return;
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
  updateFloorPosition(): void {
    if (!this.floorSprite || !(window as any).cameraManager) return;
    const FLOOR_CONFIG = {
      WIDTH_MULTIPLIER: 5,
      Y_OFFSET: -2.25,
    };
    this.floorSprite.x =
      ((window as any).cameraManager.x || 0) - this.pixiApp.screen.width * 2;
    this.floorSprite.y =
      this.pixiApp.screen.height + this.blockSize * FLOOR_CONFIG.Y_OFFSET;
  }

  /**
   * Re-render matrix and restore player position
   * @param {any} player - Player instance
   * @param {any} playerPos - Position to restore
   */
  async reRenderMatrix(player: any, playerPos: any): Promise<void> {
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
      if ((window as any).cameraManager) {
        (window as any).cameraManager.setPosition(player.x, player.y);
      }
      debug("renderEngine", "Matrix re-rendered and player position restored");
    } catch (err) {
      error("renderEngine", "Error in reRenderMatrix:", err);
    }
  }

  /**
   * Render the player sprite
   * @param {any} player - Player instance
   */
  async renderPlayer(player: any): Promise<void> {
    debug("renderEngine", "Starting renderPlayer...");
    if (this.playerSprite) {
      debug("renderEngine", "Cleaning up existing player sprite...");
      if (this.playerSprite.parent) {
        this.container.removeChild(this.playerSprite);
      }
      this.playerSprite.destroy();
      this.playerSprite = null;
    }
    debug("renderEngine", "Getting player sprite from spriteMap...");
    const spriteMap = this.spriteMap;
    if (!spriteMap) {
      error("renderEngine", "Cannot render player: spriteMap not initialized");
      return;
    }

    this.playerSprite = await getPlayerSprite(spriteMap);
    if (!this.playerSprite) {
      error("renderEngine", "Failed to get player sprite!");
      return;
    }
    debug("renderEngine", "Setting player sprite properties...");
    this.playerSprite.zIndex = 10000;
    const spriteSize = 30;
    this.playerSprite.scale.set(this.blockSize / spriteSize);
    this.setSpriteTransform(this.playerSprite, player, {
      xOffset: 0.5,
      yOffset: 0.75,
    });
    debug("renderEngine", "Adding player sprite to container...");
    this.container.addChild(this.playerSprite);
    debug("renderEngine", "Player sprite rendered successfully");
    verbose(
      "renderEngine",
      `Player sprite updated at [${player.x},${player.y}] with scale ${this.playerSprite.scale.x}, rotation ${player.rotation}`
    );
  }

  /**
   * Start the game loop
   * @param {any} player - Player instance
   * @param {any} physics - Physics engine
   */
  startGameLoop(player: any, physics: any): void {
    let lastTime = performance.now();
    this.tickerCallback = (delta: number): void => {
      const currentTime = performance.now();
      const deltaTimeSeconds = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      verbose("renderEngine", "Ticker running, delta:", deltaTimeSeconds);
      physics.update();
      this.updatePlayerPosition(player, player.rotation);
      if (!this.isPaused) {
        updateVisualEffects(this.blockSprites, deltaTimeSeconds);
        map(this.blockSprites, (sprite: Sprite) => {
          const effectType = (sprite as any).blockData?.appearance?.effectType;
          if (effectType && effectType !== "none") {
            const intensity =
              Number.parseFloat(
                (sprite as any).blockData.appearance.effectIntensity
              ) || 1;
            this.particleSystem.emit(sprite, effectType, intensity);
          }
        });
      }
      if ((window as any).cameraManager && player) {
        const playerX = player.x * this.blockSize;
        const playerY = player.y * this.blockSize;
        (window as any).cameraManager.follow(
          { x: playerX, y: playerY },
          0,
          -this.pixiApp.canvas.height * 0.2
        );
        (window as any).cameraManager.update();
      }
      if (this.isFloorInitialized) {
        this.updateFloorPosition();
        verbose(
          "renderEngine",
          "Updated floor position:",
          this.floorSprite!.x,
          this.floorSprite!.y
        );
      }
      if (!this.matrix || !this.blockSprites) {
        warn(
          "renderEngine",
          "Cannot update animations: matrix or sprites not initialized"
        );
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
        debug(
          "renderEngine",
          "Level complete! Initiating level complete sequence"
        );
        this.handleLevelComplete();
      }
    };
    if (this.tickerCallback) {
      this.pixiApp.ticker.add(
        this.tickerCallback as unknown as TickerCallback<any>,
        this
      );
    }
    debug("renderEngine", "Game loop started");
  }

  /**
   * Update player sprite position and rotation
   * @param {any} player - Player instance
   * @param {number} rotation - Rotation in degrees
   */
  updatePlayerPosition(player: any, rotation?: number): void {
    if (!this.playerSprite) return;
    this.setSpriteTransform(
      this.playerSprite,
      { ...player, rotation },
      { xOffset: 0.5, yOffset: 0.75 }
    );
    verbose(
      "renderEngine",
      `Player position updated: x=${player.x}, y=${player.y}, visualY=${
        player.y + 0.75
      }, rotation=${rotation || player.rotation || 0}`
    );
  }

  /**
   * Stop the game loop
   */
  stopGameLoop(): void {
    if (this.tickerCallback) {
      this.pixiApp.ticker.remove(
        this.tickerCallback as unknown as TickerCallback<any>
      );
      this.tickerCallback = null;
      debug("renderEngine", "Game loop stopped");
    }
  }

  /**
   * Set pause state
   * @param {boolean} isPaused - Pause or resume
   */
  setPaused(isPaused: boolean): void {
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
  update(deltaTime: number): void {
    if (this.isPaused) return;
    const now = Date.now();
    deltaTime = now - this.lastUpdateTime;
    this.lastUpdateTime = now;
    if ((window as any).physicsEngine)
      (window as any).physicsEngine.update(deltaTime);
    if ((window as any).cameraManager)
      (window as any).cameraManager.update(deltaTime);
    if (this.isFloorInitialized) this.updateFloorPosition();
    this.effectManager.update(deltaTime);
  }

  /**
   * Handle level completion
   */
  handleLevelComplete(): void {
    if (this.isLevelComplete) return;
    this.isLevelComplete = true;
    debug("renderEngine", "Handling level completion");
    this.fadeOutAudio();
    this.stopGameLoop();
    this.createLevelCompleteUI();
    const levelCompleteElement = document.getElementById("levelComplete");
    if (levelCompleteElement) {
      levelCompleteElement.style.display = "block";
      levelCompleteElement.style.opacity = "0";
      let opacity = 0;
      const fadeInterval = setInterval(() => {
        opacity += 0.15;
        levelCompleteElement.style.opacity = opacity.toString();
        if (opacity >= 1) clearInterval(fadeInterval);
      }, 15);
    }
  }

  /**
   * Create level complete UI
   */
  createLevelCompleteUI(): void {
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
    (
      document.getElementById("nextLevelBtn") as HTMLButtonElement
    ).addEventListener("click", () => {
      const urlParams = new URLSearchParams(window.location.search);
      const currentLevel = Number.parseInt(urlParams.get("level") || "1");
      window.location.href = `?level=${currentLevel + 1}`;
    });
    (document.getElementById("menuBtn") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        window.location.href = "../TDMenu.html";
      }
    );
  }

  /**
   * Set AudioManager reference
   * @param {any} audioManager - AudioManager instance
   */
  setAudioManager(audioManager: any): void {
    this.audioManager = audioManager;
    debug("renderEngine", "AudioManager reference set");
  }

  /**
   * Reset audio state
   */
  resetAudio(): void {
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
  fadeOutAudio(): void {
    if (!this.audioManager) {
      debug("renderEngine", "No AudioManager found for level completion");
      return;
    }
    try {
      if (
        this.physics?.isComplete &&
        this.physics?.audioManager === this.audioManager
      ) {
        const music =
          this.audioManager.backgroundMusic || this.audioManager.practiceMusic;
        if (music && !music.paused) this.audioManager.fadeOut(music);
      } else {
        this.audioManager.playCompletionSound(false);
      }
    } catch (err) {
      error("renderEngine", "Error handling completion audio:", err);
    }
  }
}
