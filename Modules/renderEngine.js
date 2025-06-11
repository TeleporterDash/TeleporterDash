// Modules/renderEngine.js
import { applyVisualEffects, updateVisualEffects } from "./visualEngine.js"
import { getLayerOrder } from "./layerManager.js"
import { getSprite, getPlayerSprite, getFloorSprite } from "./spriteManager.js"
import { isObjectActive } from "./groupManager.js"
import { updateAnimations, pregenerateTextures, clearTextureCache, getTextureCache } from "./animationEngine.js"
import { ParticleSystem, DistortionSystem } from "./effectEngine.js"
import { hexToNumber } from "./colorUtils.js"
import { warn, error, debug, verbose, setLogLevel } from "./logManager.js"

setLogLevel("debug")

export class RenderEngine {
  constructor(pixiApp, blockSize) {
    this.pixiApp = pixiApp
    this.blockSize = blockSize
    this.container = new window.PIXI.Container()
    this.container.sortableChildren = true
    this.pixiApp.stage.addChild(this.container)
    this.blockSprites = []
    this.playerSprite = null
    this.floorSprite = null // Initialize floor sprite
    this.tickerCallback = null
    this.matrix = null
    this.spriteMap = null
    this.cameraManager = null // Store the camera manager instance
    this.levelCompleteHandler = null // Level complete functionality
    this.isLevelComplete = false // Flag to track if level is complete
    this.audioManager = null // Reference to the AudioManager instance
    this.isPaused = false
    this.lastUpdateTime = 0
    this.pausedTime = 0
    this.wasDead = false // Track previous death state

    // Initialize particle system
    this.particleSystem = new ParticleSystem(this.container, {
      maxParticles: 500,
      poolSize: 100,
      zIndex: 10,
    })
    debug("renderEngine", "Particle system initialized")
  }

  /**
   * Show visual feedback when a modifier is activated
   * @param {Object} modifier - The modifier that was activated
   */
  async showModifierActivation(modifier) {
    if (!modifier) return

    // Get the screen position of the modifier
    const screenX = (modifier.x + 0.5) * this.blockSize
    const screenY = (modifier.y + 0.5) * this.blockSize

    // Create explosion effect asynchronously
    const createExplosion = () => {
      return new Promise((resolve) => {
        if (this.particleSystem) {
          // Create explosion with modifier color (default to cyan)
          const explosionColor = 0x00ffff // Cyan color
          this.particleSystem.createExplosion(
            { x: screenX, y: screenY }, // Pass position directly
            explosionColor,
            20, // Particle count
            this.blockSize * 0.8, // Max radius
          )

          // Resolve after a short delay to ensure particles are created
          setTimeout(resolve, 300)
        } else {
          resolve()
        }
      })
    }

    // Start the explosion animation and wait for it to complete
    await createExplosion()
  }

  // --- Replaced clear() with reset() ---
  reset() {
    // Stop any existing game loop
    this.stopGameLoop()

    // Reset isLevelComplete flag
    this.isLevelComplete = false

    // Reset audio when restarting the game
    this.resetAudio()

    // Reset the particle system if it exists
    if (this.particleSystem) {
      try {
        this.particleSystem.reset()
      } catch (err) {
        error("renderEngine", "Error resetting particle system:", err)
      }
    }

    // Less aggressive cleanup - just remove sprites from scene without destroying textures
    // This allows reusing assets between restarts
    this.blockSprites.forEach((sprite) => {
      try {
        // Remove from parent container
        if (sprite.parent) {
          sprite.parent.removeChild(sprite)
        }

        // Clean up particle container if present
        if (sprite.particleContainer && sprite.particleContainer.parent) {
          sprite.particleContainer.parent.removeChild(sprite.particleContainer)
          // Only destroy the container, not the textures
          sprite.particleContainer.destroy({ children: false, texture: false, baseTexture: false })
        }

        // Clear filters but don't destroy them
        if (sprite.filters && Array.isArray(sprite.filters)) {
          sprite.filters = null
        }

        // Only destroy the sprite, not its textures
        // This allows the textures to be reused
        sprite.destroy({ children: false, texture: false, baseTexture: false })
      } catch (err) {
        error("renderEngine", "Error cleaning up sprite:", err)
      }
    })
    this.blockSprites = [] // Reset the array AFTER cleanup

    // When shutting down completely or when memory usage is high,
    // consider a full texture cleanup by passing { removeTextures: true } to destroy()

    // Clear player sprite - less aggressive cleanup
    if (this.playerSprite) {
      try {
        // Just remove from scene
        if (this.playerSprite.parent) {
          this.playerSprite.parent.removeChild(this.playerSprite)
        }

        // Only destroy the sprite container, preserve textures
        this.playerSprite.destroy({ children: false, texture: false, baseTexture: false })
        this.playerSprite = null
      } catch (err) {
        error("renderEngine", "Error cleaning up player sprite:", err)
      }
    }

    // Clear floor sprite - less aggressive cleanup
    if (this.floorSprite) {
      try {
        // Just remove from scene
        if (this.floorSprite.parent) {
          this.floorSprite.parent.removeChild(this.floorSprite)
        }

        // Only destroy the sprite container, preserve textures
        this.floorSprite.destroy({ children: false, texture: false, baseTexture: false })
        this.floorSprite = null
      } catch (err) {
        error("renderEngine", "Error cleaning up floor sprite:", err)
      }
    }

    // Keep app and blockSize

    // Clean up animation texture cache
    clearTextureCache()

    // Don't purge texture cache on normal reset
    // Textures will be reused between level resets
    // Clear the state but keep the assets
    debug("renderEngine", "Reset complete - textures preserved for reuse")

    // Log audio reset status
    debug("renderEngine", "Audio reset complete")

    // Reset container position/scale if needed (optional, depends on camera handling)
    this.container.x = 0
    this.container.y = 0
    // this.container.scale.set(1);

    // Note: CameraManager might need its own reset method called elsewhere

    debug("RenderEngine", "RenderEngine reset complete.")
  }
  // --- End reset() ---

  async renderMatrix(matrix, spriteMap) {
    this.matrix = matrix
    this.spriteMap = spriteMap

    // Clear existing non-floor sprites AND their associated particle containers
    this.blockSprites.forEach((sprite) => {
      // Remove and destroy associated particle container if it exists
      if (sprite.particleContainer && sprite.particleContainer.parent) {
        // Check parent because removeChild needs the actual parent
        sprite.particleContainer.parent.removeChild(sprite.particleContainer)
        sprite.particleContainer.destroy({ children: true }) // Destroy container and its particle children
      }
      // Remove the main sprite itself if it has a parent (it should be this.container)
      if (sprite.parent) {
        sprite.parent.removeChild(sprite)
      }
      // Destroy the sprite object to free resources
      sprite.destroy()
    })
    this.blockSprites = [] // Reset the array AFTER cleanup

    const textureAssets = []
    // Pre-generate textures for animations and initialize effects
    debug("renderEngine", "Starting texture and effect initialization")
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        const object = matrix[y][x]
        if (!object || !isObjectActive(object) || object.type === 0) continue

        // Initialize appearance if it doesn't exist
        if (!object.appearance) {
          object.appearance = {}
        }
        if (!object.appearance.color) {
          object.appearance.color = {}
        }

        // Set default values
        object.colorShiftRate = Number.parseFloat(object.appearance?.color?.shiftRate) || 0
        object.colorPulse = object.appearance?.color?.pulseColor || "0"
        object.colorPulseRate = Number.parseFloat(object.appearance?.color?.pulseRate) || 0
        object.baseColor = object.appearance?.color?.base || "#888"
        object.tintColor = object.appearance?.color?.tint || "0"
        object.tintIntensity = Number.parseFloat(object.appearance?.color?.tintIntensity) || 0
        object.svg = spriteMap.get(String(object.type))?.svg

        // Initialize effect properties
        object.effectType = object.appearance?.effectType || "none"
        object.effectIntensity = Number.parseFloat(object.appearance?.effectIntensity) || 1
        object.effectSpeed = Number.parseFloat(object.appearance?.effectSpeed) || 1

        verbose(
          "renderEngine",
          `Initializing cell at [${x},${y}] with effect: ${object.effectType}, intensity: ${object.effectIntensity}`,
        )
        pregenerateTextures(object, x, y)
      }
      debug("renderEngine", "Texture pre-generation complete")
    }

    // Get texture assets from cache
    const cache = getTextureCache()
    for (const [cacheKey, { src }] of cache.entries()) {
      textureAssets.push({ alias: cacheKey, src })
    }
    if (textureAssets.length > 0) {
      await window.PIXI.Assets.load(textureAssets)
      for (const { alias } of textureAssets) {
        cache.set(alias, window.PIXI.Assets.get(alias))
      }
      debug(
        "renderEngine",
        "Preloaded animation textures:",
        textureAssets.map((asset) => asset.alias),
      )
    }

    // --- Floor rendering - completely revised ---
    // Always recreate the floor sprite to match current state
    if (this.floorSprite) {
      if (this.floorSprite.parent) {
        this.floorSprite.parent.removeChild(this.floorSprite)
      }
      this.floorSprite.destroy()
      this.floorSprite = null
    }
    await this.renderFloor()
    // --- End floor rendering ---

    const blocks = getLayerOrder(matrix).map(({ object, x, y }) => ({
      object,
      x: x * this.blockSize + this.blockSize / 2,
      y: y * this.blockSize + this.blockSize / 2,
    }))

    for (const { object, x, y } of blocks) {
      // Skip empty cells and inactive objects
      if (!object || !isObjectActive(object)) {
        continue
      }

      let sprite

      // Handle modifier blocks (types 21-25)
      if (object.isModifier && object.modifierType) {
        // Use the modifier type to get the correct sprite without colorization
        // Modifiers have their own styling, so we don't apply additional colors
        sprite = await getSprite(object.modifierType, spriteMap, { skipColorize: true })

        if (!sprite) {
          // Fallback for missing modifier sprites
          sprite = new window.PIXI.Graphics()
          const color = 0x8888ff // Default blue color for modifiers
          sprite
            .circle(0, 0, this.blockSize * 0.4)
            .fill({ color, alpha: 0.7 })
            .stroke({ width: 2, color: 0xffffff, alpha: 0.9 })

          // Add a small icon or text to indicate the modifier type
          const text = new window.PIXI.Text(String(object.modifierType - 20), {
            fontFamily: "Arial",
            fontSize: this.blockSize * 0.4,
            fill: 0xffffff,
            align: "center",
          })
          text.anchor.set(0.5)
          sprite.addChild(text)
        }
      } else {
        // Handle regular blocks
        sprite = await getSprite(
          object.type,
          spriteMap,
          object.appearance?.color || { base: "#888", tint: "0", tintIntensity: 0 },
        )

        if (!sprite) {
          warn(
            "renderEngine",
            `No sprite for block type ${object.type} at [${x / this.blockSize},${y / this.blockSize}]`,
          )
          sprite = new window.PIXI.Graphics()
          const color = object.appearance?.color?.base ? hexToNumber(object.appearance.color.base) : 0x888888
          sprite.rect(-this.blockSize / 2, -this.blockSize / 2, this.blockSize, this.blockSize).fill({ color })
        }
      }

      sprite.x = x
      sprite.y = y
      sprite.rotation = (object.transform?.rotation * Math.PI) / 180 || 0
      sprite.scale.set(
        (object.transform?.scale || 1) * (object.transform?.flip === "h" || object.transform?.flip === "hv" ? -1 : 1),
        (object.transform?.scale || 1) * (object.transform?.flip === "v" || object.transform?.flip === "hv" ? -1 : 1),
      )

      if (object.appearance?.opacity != null) {
        sprite.alpha = Number.parseFloat(object.appearance.opacity)
      }

      if (object.appearance?.depthOffset != null) {
        sprite.zIndex = Number.parseFloat(object.layer || 0) * 1000 + Number.parseFloat(object.appearance.depthOffset)
      } else {
        sprite.zIndex = Number.parseFloat(object.layer || 0) * 1000
      }

      sprite.animation = object.animation || { pulseRate: 0, pulseAmplitude: 0, syncType: "0" }
      sprite.colorShiftRate = Number.parseFloat(object.appearance?.color?.shiftRate) || 0
      sprite.colorPulse = object.appearance?.color?.pulseColor || "0"
      sprite.colorPulseRate = Number.parseFloat(object.appearance?.color?.pulseRate) || 0
      sprite.baseColor = object.appearance?.color?.base || "#888"
      sprite.tintColor = object.appearance?.color?.tint || "0"
      sprite.tintIntensity = Number.parseFloat(object.appearance?.color?.tintIntensity) || 0

      applyVisualEffects(sprite, object.appearance)

      // Create and apply distortion effect if specified
      if (object.appearance?.effects?.distortion) {
        const distortionConfig = object.appearance.effects.distortion
        const effectType = distortionConfig.type || "wave"
        const intensity = Number.parseFloat(distortionConfig.intensity) || 1

        sprite.distortionEffect = new DistortionSystem(sprite, effectType, intensity)
        debug(
          "renderEngine",
          `Applied ${effectType} distortion effect with intensity ${intensity} to sprite at [${x / this.blockSize},${y / this.blockSize}]`,
        )
      }

      this.container.addChild(sprite)
      this.blockSprites.push(sprite)
      verbose(
        "renderEngine",
        `Rendered sprite type ${object.type} at [${x / this.blockSize - 0.5},${y / this.blockSize - 0.5}] with opacity ${sprite.alpha}, zIndex ${sprite.zIndex}`,
      )
    }
  }

  /**
   * Render the floor sprite with proper positioning
   * The floor will follow the camera in the update cycle for an infinite appearance
   * @returns {Promise<void>}
   */
  async renderFloor() {
    debug("renderEngine", "Rendering floor...")

    // Avoid duplicate floor sprites
    if (this.floorSprite && this.floorSprite.parent) {
      warn("renderEngine", "renderFloor called but floorSprite already exists and is attached.")
      return
    }

    // Clean up any existing floor sprite
    if (this.floorSprite) {
      if (this.floorSprite.parent) {
        this.floorSprite.parent.removeChild(this.floorSprite)
      }
      this.floorSprite.destroy()
      this.floorSprite = null
    }

    if (!this.spriteMap) {
      error("renderEngine", "Cannot render floor: spriteMap is not initialized")
      return
    }

    try {
      // Get floor sprite - spriteManager will provide a fallback if needed
      this.floorSprite = await getFloorSprite(this.spriteMap)

      // Configure the floor sprite
      // Width is set to 5x screen width to ensure it extends beyond visible area
      // when camera moves
      this.floorSprite.width = this.pixiApp.screen.width * 5
      this.floorSprite.height = this.blockSize

      // Position floor 0.25 blocks lower for better alignment with physics
      this.floorSprite.y = this.pixiApp.screen.height - this.blockSize * 2.25
      this.floorSprite.x = -this.pixiApp.screen.width // Start off-screen to the left
      this.floorSprite.zIndex = -10 // Put it behind everything

      // Set flag for update cycle to track floor with camera
      this.isFloorInitialized = true

      // Add to container
      this.container.addChild(this.floorSprite)

      verbose("renderEngine", "Floor rendered successfully", {
        width: this.floorSprite.width,
        height: this.floorSprite.height,
        x: this.floorSprite.x,
        y: this.floorSprite.y,
      })
    } catch (err) {
      error("renderEngine", "Error rendering floor:", err)
    }
  }
  // --- End new method ---

  /**
   * Re-render the matrix and restore the player's position.
   * @param {Object} player - The player instance to update.
   * @param {Object} playerPos - The position to restore ({ x, y }).
   */
  async reRenderMatrix(player, playerPos) {
    if (!playerPos || !player) {
      warn("renderEngine", "reRenderMatrix called without required arguments")
      return
    }

    if (this.matrix && this.spriteMap && player && playerPos) {
      try {
        // Store current player position before matrix update
        const prevX = player.x
        const prevY = player.y

        // Re-render the matrix (this will clear and redraw all blocks/sprites)
        // Always recreate the floor sprite to match current state
        if (this.floorSprite) {
          if (this.floorSprite.parent) {
            this.floorSprite.parent.removeChild(this.floorSprite)
          }
          this.floorSprite.destroy()
          this.floorSprite = null
        }
        await this.renderFloor()
        await this.renderMatrix(this.matrix, this.spriteMap)

        // Restore player position
        player.x = playerPos.x
        player.y = playerPos.y

        // Only update player sprite if position changed
        if (prevX !== player.x || prevY !== player.y) {
          await this.renderPlayer(player)
        }

        if (cameraManager) {
          cameraManager.setPosition(player.x, player.y)
        }
        debug("renderEngine", "Matrix re-rendered and player position restored")
      } catch (err) {
        error("renderEngine", "Error in reRenderMatrix:", err)
      }
    } else {
      warn("renderEngine", "reRenderMatrix called without required arguments")
    }
  }

  async renderPlayer(player) {
    // Always remove the old sprite regardless of parent
    if (this.playerSprite) {
      debug("renderEngine", "Removing old player sprite")
      if (this.playerSprite.parent) {
        this.container.removeChild(this.playerSprite)
      }
      this.playerSprite.destroy()
      this.playerSprite = null
      verbose("renderEngine", "Container children after player removal:", this.container.children)
    }
    verbose("renderEngine", "Rendering player at", player.x, player.y)
    // getPlayerSprite will provide a fallback if needed
    this.playerSprite = await getPlayerSprite(this.spriteMap)
    verbose("renderEngine", "Container children after player addition:", this.container.children)
    this.playerSprite.zIndex = 10000

    if (this.playerSprite) {
      const spriteSize = 30
      const scale = this.blockSize / spriteSize
      this.playerSprite.scale.set(scale * player.facing, scale)
      this.playerSprite.x = (player.x + 0.5) * this.blockSize
      this.playerSprite.y = (player.y + 0.5) * this.blockSize
      this.playerSprite.rotation = ((player.rotation || 0) * Math.PI) / 180 // Apply rotation in radians
      if (!this.playerSprite.parent) {
        this.container.addChild(this.playerSprite)
      }
      debug("renderEngine", "Player sprite rendered successfully")

      verbose(
        "renderEngine",
        `Player sprite updated at [${player.x},${player.y}] with scale ${scale}, rotation ${player.rotation}`,
      )
    }
  }

  startGameLoop(player, physics) {
    let lastTime = performance.now()
    this.tickerCallback = (delta) => {
      const currentTime = performance.now()
      const deltaTimeSeconds = (currentTime - lastTime) / 1000 // Convert to seconds
      lastTime = currentTime

      verbose("renderEngine", "Ticker running, delta:", deltaTimeSeconds)

      // Update physics and player position
      physics.update()
      this.updatePlayerPosition(player, player.rotation)

      // Update particle system if not paused
      if (!this.isPaused && this.particleSystem) {
        this.particleSystem.update(deltaTimeSeconds)
      }

      if (window.cameraManager && player) {
        const playerX = player.x * this.blockSize
        const playerY = player.y * this.blockSize
        const verticalOffset = -this.pixiApp.canvas.height * 0.2
        window.cameraManager.follow({ x: playerX, y: playerY }, 0, verticalOffset)
        window.cameraManager.update()
      }

      // Update floor position to follow camera
      if (this.floorSprite && window.cameraManager) {
        const cameraX = window.cameraManager.x || 0
        const floorX = cameraX - this.pixiApp.screen.width
        const floorY = this.pixiApp.screen.height - (this.blockSize / 3 - 11)

        if (Math.abs(this.floorSprite.x - floorX) > 5 || Math.abs(this.floorSprite.y - floorY) > 5) {
          this.floorSprite.x = floorX
          this.floorSprite.y = floorY
          verbose("renderEngine", "Updated floor position:", floorX, floorY)
        }
      }

      if (!this.matrix || !this.blockSprites || !Array.isArray(this.blockSprites)) {
        warn("renderEngine", "Cannot update animations: matrix or sprites not initialized")
        return
      }

      try {
        updateAnimations(this.matrix, delta, this.blockSprites)
      } catch (error) {
        error("renderEngine", "Error updating animations:", error)
      }

      try {
        updateVisualEffects(this.blockSprites, delta)

        // Update particle effects for blocks
        this.blockSprites.forEach((sprite, index) => {
          if (sprite.blockData?.appearance?.effectType) {
            const effectType = sprite.blockData.appearance.effectType
            const intensity = Number.parseFloat(sprite.blockData.appearance.effectIntensity) || 1

            // Emit particles based on effect type
            switch (effectType) {
              case "sparkle":
                this.particleSystem.emit(sprite, "sparkle", intensity)
                break
              case "wave":
                this.particleSystem.emit(sprite, "wave", intensity)
                break
              case "ripple":
                this.particleSystem.emit(sprite, "ripple", intensity)
                break
              case "twist":
                this.particleSystem.emit(sprite, "explosion", intensity)
                break
            }
          }
        })
      } catch (error) {
        error("renderEngine", "Error updating visual effects:", error)
      }

      try {
        // Update all distortion effects
        this.blockSprites.forEach((sprite) => {
          if (sprite.distortionEffect) {
            sprite.distortionEffect.update(delta)
          }
        })

        if (this.particleSystem) {
          this.particleSystem.update(delta)
        }
      } catch (error) {
        error("renderEngine", "Error updating effects:", error)
      }

      // Only log death once per death event
      if (physics.isDead && !this.wasDead) {
        debug("renderEngine", "Player died!")
        this.wasDead = true
      } else if (!physics.isDead) {
        this.wasDead = false
      }

      if (physics.isComplete && !this.isLevelComplete) {
        debug("renderEngine", "Level complete! Initiating level complete sequence")
        this.handleLevelComplete()
      }
    }
    this.pixiApp.ticker.add(this.tickerCallback)
    debug("renderEngine", "Game loop started")
  }

  /**
   * Update the player sprite's position, rotation and scale based on player state
   * @param {Object} player - The player object containing position and state
   * @param {number} rotation - The rotation in degrees to apply to the player sprite
   */
  updatePlayerPosition(player, rotation) {
    if (!this.playerSprite) return

    // Set horizontal position (centered within block)
    this.playerSprite.x = (player.x + 0.5) * this.blockSize

    // Set vertical position with offset to make the cube sit properly on the floor
    // Using 0.75 offset (instead of 0.5) to move the cube down by 0.25 blocks
    // This aligns with the physics engine's floor position calculations
    this.playerSprite.y = (player.y + 0.75) * this.blockSize

    // Apply horizontal facing direction (flips sprite)
    this.playerSprite.scale.x = Math.abs(this.playerSprite.scale.x) * player.facing

    // Apply rotation (converting from degrees to radians)
    const rot = rotation !== undefined ? rotation : player.rotation || 0
    this.playerSprite.rotation = (rot * Math.PI) / 180

    // Log position update with visual Y position for debugging
    verbose(
      "renderEngine",
      `Player position updated: x=${player.x}, y=${player.y}, visualY=${player.y + 0.75}, rotation=${rot}`,
    )
  }

  stopGameLoop() {
    if (this.tickerCallback) {
      this.pixiApp.ticker.remove(this.tickerCallback)
      this.tickerCallback = null
      debug("renderEngine", "Game loop stopped")
    }
  }

  /**
   * Set the pause state of the render engine
   * @param {boolean} isPaused - Whether to pause or resume
   */
  setPaused(isPaused) {
    this.isPaused = isPaused
    if (isPaused) {
      this.pausedTime = Date.now()
    } else {
      // Calculate time difference to compensate for pause
      const now = Date.now()
      this.lastUpdateTime += now - this.pausedTime
    }
  }

  /**
   * Update the render engine
   * @param {number} deltaTime - Time since last update in milliseconds
   */
  update(deltaTime) {
    if (this.isPaused) {
      return
    }

    // Compensate for pause time
    const now = Date.now()
    deltaTime = now - this.lastUpdateTime
    this.lastUpdateTime = now

    // Update physics if not paused
    if (physicsEngine) {
      physicsEngine.update(deltaTime)
    }

    // Update camera if not paused
    if (cameraManager) {
      cameraManager.update(deltaTime)
    }

    // Keep floor centered on camera for infinite floor appearance
    if (this.isFloorInitialized && this.floorSprite && cameraManager) {
      // Get current camera position (default to 0 if undefined)
      const cameraX = cameraManager.x || 0

      // Position floor relative to camera to create infinite floor illusion
      // The floor extends 2x screen width to the left of camera position
      // Combined with the floor's 5x screen width, this ensures coverage beyond visible edges
      this.floorSprite.x = cameraX - this.pixiApp.screen.width * 2

      // Only log floor position updates at verbose level to avoid console spam
      verbose("renderEngine", `Updating floor position to follow camera: ${this.floorSprite.x}`)
    }

    // Update particles if not paused
    if (this.particleSystem) {
      this.particleSystem.update(deltaTime)
    }

    // Update visual effects if not paused
    if (effectEngine) {
      effectEngine.update(deltaTime)
    }
  }

  /**
   * Handles level completion with proper visual and audio transitions
   * Similar to the gameloader.html implementation
   */
  handleLevelComplete() {
    if (this.isLevelComplete) return // Prevent multiple calls
    this.isLevelComplete = true
    debug("renderEngine", "Handling level completion")

    // 1. Handle audio (play completion sound and fade music)
    this.fadeOutAudio()

    // 2. Completely stop the game loop as requested
    this.stopGameLoop()
    debug("renderEngine", "Game loop stopped for level completion")

    // 3. Create level complete UI if it doesn't exist
    this.createLevelCompleteUI()

    // 4. Show level complete screen with faster animation
    const levelCompleteElement = document.getElementById("levelComplete")
    if (levelCompleteElement) {
      levelCompleteElement.style.display = "block"
      levelCompleteElement.style.opacity = 0

      // Faster fade in animation
      let opacity = 0
      const fadeInterval = setInterval(() => {
        opacity += 0.15 // Increased step size for faster fade-in
        levelCompleteElement.style.opacity = opacity
        if (opacity >= 1) {
          clearInterval(fadeInterval)
        }
      }, 15) // Reduced interval time for faster updates
    }
  }

  /**
   * Creates the level complete UI elements if they don't exist
   */
  createLevelCompleteUI() {
    debug("renderEngine", "Creating level complete UI")

    // Check if UI already exists
    if (document.getElementById("levelComplete")) {
      return
    }

    // Create level complete screen div styled like in gameloader.html
    const levelCompleteElement = document.createElement("div")
    levelCompleteElement.id = "levelComplete"
    levelCompleteElement.style.cssText = `
      position: fixed;
      top: 40%;
      left: 50%;
      transform: translate(-50%, 0);
      transform-style: preserve-3d;
      perspective: none;
      background: rgba(0, 0, 0, 0.8);
      color: #00ff00;
      font-size: 48px;
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      z-index: 9999;
      display: none;
    `

    // Add content to level complete div
    levelCompleteElement.innerHTML = `
      Level Complete!
      <br>
      <button id="nextLevelBtn" 
        style="background: #4285F4; color: white; padding: 10px 20px; border: none; border-radius: 5px; margin: 10px; cursor: pointer;">
        Next Level
      </button>
      <button id="menuBtn" 
        style="background: #4285F4; color: white; padding: 10px 20px; border: none; border-radius: 5px; margin: 10px; cursor: pointer;">
        Back to Menu
      </button>
    `

    // Add to document body
    document.body.appendChild(levelCompleteElement)

    // Add event listeners for buttons
    document.getElementById("nextLevelBtn").addEventListener("click", () => {
      // Logic to load next level would go here
      // This would typically involve accessing URL parameters to get current level
      // and then incrementing to next level
      const urlParams = new URLSearchParams(window.location.search)
      const currentLevel = Number.parseInt(urlParams.get("level") || "1")
      window.location.href = `?level=${currentLevel + 1}`
    })

    document.getElementById("menuBtn").addEventListener("click", () => {
      window.location.href = "../TDMenu.html"
    })
  }

  /**
   * Set reference to the AudioManager instance
   * @param {AudioManager} audioManager - The game's AudioManager instance
   */
  setAudioManager(audioManager) {
    this.audioManager = audioManager
    debug("renderEngine", "AudioManager reference set")
  }

  /**
   * Reset audio state using the AudioManager and restart background music
   */
  resetAudio() {
    try {
      // Find an available AudioManager instance
      let audioManager = this.audioManager || window.audioManager
      if (!audioManager && this.physics) {
        audioManager = this.physics.audioManager
      }

      if (audioManager) {
        debug("renderEngine", "Resetting audio via AudioManager")

        // First reset all audio elements and state
        audioManager.reset()

        // Then restart background music
        setTimeout(() => {
          try {
            debug("renderEngine", "Restarting background music after reset")
            audioManager.playBackgroundMusic()
          } catch (err) {
            error("renderEngine", "Error restarting background music:", err)
          }
        }, 100) // Small delay to ensure reset completes first
      }
    } catch (err) {
      error("renderEngine", "Error resetting audio:", err)
    }
  }

  /**
   * Handles audio for level completion
   * Delegates to AudioManager which already handles all completion audio
   */
  fadeOutAudio() {
    // Find available AudioManager instance
    let audioManager = this.audioManager || window.audioManager
    if (!audioManager && this.physics) {
      audioManager = this.physics.audioManager
    }

    if (!audioManager) {
      debug("renderEngine", "No AudioManager found for level completion")
      return // PhysicsEngine will handle sound if possible
    }

    try {
      // Let AudioManager handle everything - it knows whether to play
      // the completion sound (if not already played) and fade music
      if (this.physics?.isComplete && this.physics?.audioManager === audioManager) {
        // Physics engine already using same AudioManager, likely already played sound
        // Just make sure music is fading
        debug("renderEngine", "Ensuring music fades for level completion")
        const music = audioManager.backgroundMusic || audioManager.practiceMusic
        if (music && !music.paused) audioManager.fadeOut(music)
      } else {
        // First time handling completion, play sound and fade music
        debug("renderEngine", "Playing completion sound for level completion")
        audioManager.playCompletionSound(false)
      }
    } catch (err) {
      error("renderEngine", "Error handling completion audio:", err)
    }
  }
}
