// Modules/physicsEngine.js
import { getTeleportTarget } from "./teleporterEngine.js"
import { isObjectActive, triggerGroup, handleUnlockOrb } from "./groupManager.js"
import cameraManager from "./cameraManager.js"
import { debug, verbose } from "./logManager.js"
import { timeManager } from "./timeManager.js"

// Constants for better readability and configuration
const PHYSICS_CONSTANTS = {
  GRAVITY: 0.015,
  MAX_FALL_SPEED: 0.4,
  MOVE_SPEED: 0.07,
  JUMP_FORCE: -0.32,
  DOUBLE_JUMP_FORCE: -0.33,
  JUMP_BUFFER_TIME: 200,
  COYOTE_TIME: 200,
  LANE_SWITCH_DELAY: 150,
  ROTATION_SPEED: 180, // Degrees per second
}

// Block type enum for better readability
const BLOCK_TYPE = {
  FINISH: 4,
  TELEPORTER: 3,
  TELEPORT_START: 7,
  TELEPORT_END: 8,
  CLIPPER_MODE: 5,
  CLASSIC_MODE: 6,
  TRIGGER: 13,
  UNLOCK_ORB: 14,
  LEFT_ORB: 11,
  RIGHT_ORB: 12,
}

class Player {
  constructor(x, y, levelHeight) {
    this.initialX = x
    this.initialY = levelHeight * 0.98 - 1 // Position just above the floor
    this.levelHeight = levelHeight
    this.reset()
  }

  calculateLanePositions() {
    const effectiveLevelHeight = this.levelHeight - 1
    const laneSpacing = effectiveLevelHeight / 3
    return [
      laneSpacing * 0.25, // Top lane
      laneSpacing * 1.5, // Middle lane
      effectiveLevelHeight - 0.75, // Bottom lane (just above floor)
    ]
  }

  reset() {
    this.x = this.initialX
    this.y = this.initialY
    this.width = 1
    this.height = 1
    this.vx = 0
    this.vy = 0
    this.isJumping = false
    this.isOnPlatform = true // Start on platform (floor)
    this.doubleJumpAvailable = true // Allow double jump initially
    this.lastGroundedTime = Date.now() // For coyote time
    this.facing = 1
    this.mode = "classic"
    this.lane = 1
    this.isFreeMoving = false
    this.teleportCooldown = 0
    this.score = 0
    this.lanePositions = this.calculateLanePositions()
    this.jumpForce = PHYSICS_CONSTANTS.JUMP_FORCE
    this.doubleJumpForce = PHYSICS_CONSTANTS.DOUBLE_JUMP_FORCE
    this.jumpsRemaining = 2 // Allow 2 jumps (first + double jump)
    this.rotation = 0 // Current rotation in degrees
    this.rotationSpeed = PHYSICS_CONSTANTS.ROTATION_SPEED
    this.jumpRotationDirection = 1 // 1 for clockwise, -1 for counterclockwise
    this.laneSwitchCooldown = 0
    this.laneSwitchDelay = PHYSICS_CONSTANTS.LANE_SWITCH_DELAY

    verbose(
      "PhysicsEngine",
      "Player reset: jumpsRemaining =",
      this.jumpsRemaining,
      "doubleJumpAvailable =",
      this.doubleJumpAvailable,
      "rotation =",
      this.rotation,
      "jumpRotationDirection =",
      this.jumpRotationDirection,
    )
  }

  /**
   * Handle player jump action with support for double jumping
   * @returns {boolean} True if jump was successful, false otherwise
   */
  jump() {
    if (this.mode !== "classic") {
      verbose("PhysicsEngine", "Jump blocked: mode =", this.mode)
      return false
    }

    // First jump from ground
    if (this.isOnPlatform || this.jumpsRemaining === 2) {
      this.vy = this.jumpForce
      this.isJumping = true
      this.isOnPlatform = false
      this.doubleJumpAvailable = true // Enable double jump after first jump
      verbose("PhysicsEngine", "First jump from ground")
    }
    // Double jump in air
    else if (this.doubleJumpAvailable) {
      this.vy = this.doubleJumpForce
      this.doubleJumpAvailable = false
      verbose("PhysicsEngine", "Second jump (double jump) in air")
    }
    // Can't jump
    else {
      verbose("PhysicsEngine", "Jump failed: not on ground and no double jump available")
      return false
    }

    this.jumpsRemaining = this.isOnPlatform ? 1 : 0

    verbose(
      "PhysicsEngine",
      `Jump performed: vy=${this.vy}, doubleJumpAvailable=${this.doubleJumpAvailable}, isJumping=${this.isJumping}`,
    )
    return true
  }

  /**
   * Determine if player can jump based on current state
   * @param {number} coyoteTimeWindow - Time window in ms where player can still jump after leaving platform
   * @param {number} currentTime - Current game time in ms
   * @returns {boolean} True if player can jump, false otherwise
   */
  canJump(coyoteTimeWindow, currentTime) {
    const withinCoyoteTime = currentTime - this.lastGroundedTime <= coyoteTimeWindow

    // First jump: player is on platform or within coyote time
    if (this.isOnPlatform || withinCoyoteTime) {
      return true
    }

    // Double jump: player is in the air and double jump is available
    if (this.doubleJumpAvailable && this.vy !== 0) {
      return true
    }

    return false
  }

  switchLane(direction) {
    if (this.mode !== "clipper" || this.laneSwitchCooldown > 0) return false

    const newLane = Math.max(0, Math.min(2, this.lane + direction))

    if (newLane !== this.lane) {
      this.lane = newLane
      this.laneSwitchCooldown = this.laneSwitchDelay
      verbose("PhysicsEngine", `Lane switched to ${this.lane}, cooldown started`)

      if (!this.isFreeMoving) {
        this.y = this.lanePositions[this.lane]
      }

      return true
    }

    return false
  }

  startFreeMove() {
    if (this.mode !== "clipper" || (this.lane !== 0 && this.lane !== 2)) return false
    this.isFreeMoving = true
    return true
  }

  endFreeMove() {
    if (this.mode !== "clipper") return false
    this.isFreeMoving = false
    this.y = this.lanePositions[this.lane]
    return true
  }

  cleanup() {
    this.x = 0
    this.y = 3
    this.vx = 0
    this.vy = 0
    this.isJumping = false
    this.isOnPlatform = false
    this.doubleJumpAvailable = true
    this.lastGroundedTime = Date.now()
    this.facing = 1
    this.mode = "classic"
    this.lane = 1
    this.isFreeMoving = false
    this.teleportCooldown = 0
    this.score = 0
    this.jumpsRemaining = 2
    this.rotation = 0
    this.jumpRotationDirection = 1
    debug(
      "PhysicsEngine",
      "Player cleanup: jumpsRemaining =",
      this.jumpsRemaining,
      "rotation =",
      this.rotation,
      "jumpRotationDirection =",
      this.jumpRotationDirection,
    )
  }

  update(deltaTime) {
    // Update lane switch cooldown
    if (this.laneSwitchCooldown > 0) {
      this.laneSwitchCooldown = Math.max(0, this.laneSwitchCooldown - deltaTime)
    }

    // Update teleport cooldown
    if (this.teleportCooldown > 0) {
      this.teleportCooldown--
    }

    // Update rotation during jumps
    if (this.isJumping && this.mode === "classic") {
      this.rotation += this.jumpRotationDirection * this.rotationSpeed * (deltaTime / 1000)
      verbose(
        "PhysicsEngine",
        "Jump rotation updated: rotation =",
        this.rotation,
        "jumpRotationDirection =",
        this.jumpRotationDirection,
        "deltaTime =",
        deltaTime,
      )

      // Normalize rotation to 0-360 range
      this.rotation = this.rotation % 360
      if (this.rotation < 0) this.rotation += 360
    } else {
      // Always force rotation to exactly zero when not jumping
      // This ensures the player never spins after landing
      this.rotation = 0
    }
  }

  setMode(mode) {
    if (mode === "classic" || mode === "clipper") {
      this.mode = mode

      if (mode === "clipper") {
        this.lane = 1
        this.y = this.lanePositions[this.lane]
        this.vy = 0
        this.isFreeMoving = false
      }

      this.rotation = 0
      this.jumpRotationDirection = 1
      return true
    }
    return false
  }

  setFacing(direction) {
    if (direction === 1 || direction === -1) {
      this.facing = direction
      this.jumpRotationDirection = direction
      return true
    }
    return false
  }
}

class PhysicsEngine {
  constructor(levelMatrix, player, renderEngine, audioManager, cameraManager) {
    this.lastHazardColor = null // Track the last hazard color for death effects
    this.levelMatrix = levelMatrix
    // Exact floor level calculation aligned with renderEngine's floor position
    const floorLevel = levelMatrix.length + 0.00001
    this.player = player || new Player(0, floorLevel - 0.5, levelMatrix.length)
    this.renderEngine = renderEngine
    this.audioManager = audioManager
    this.cameraManager = cameraManager // Store camera manager reference
    this.gravity = PHYSICS_CONSTANTS.GRAVITY
    this.maxFallSpeed = PHYSICS_CONSTANTS.MAX_FALL_SPEED
    this.moveSpeed = PHYSICS_CONSTANTS.MOVE_SPEED
    this.isDead = false
    this.isComplete = false
    this.keys = {}
    this.coyoteTime = PHYSICS_CONSTANTS.COYOTE_TIME
    this.lastJumpPressTime = 0
    this.lastUpdateTime = 0
    this.lastLaneSwitchTime = 0
    this.unlockedGroups = new Set()
    this.isPaused = false
    this._eventListeners = { keydown: null, keyup: null }
    this.activeModifiers = new Set() // Track active modifiers
    this.groundLevel = floorLevel
    this.jumpBufferTime = PHYSICS_CONSTANTS.JUMP_BUFFER_TIME

    // Initialize keys explicitly to avoid undefined errors
    this.keys = {
      Space: false,
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false,
      w: false,
      a: false,
      s: false,
      d: false,
    }

    this.setupEventListeners()
  }

  // Getter for player state (useful for external systems)
  getPlayerState() {
    return {
      x: this.player.x,
      y: this.player.y,
      vx: this.player.vx,
      vy: this.player.vy,
      mode: this.player.mode,
      lane: this.player.lane,
      isJumping: this.player.isJumping,
      isOnPlatform: this.player.isOnPlatform,
      jumpsRemaining: this.player.jumpsRemaining,
      facing: this.player.facing,
      rotation: this.player.rotation,
    }
  }

  setupEventListeners() {
    const keydownHandler = (event) => this.processKeyEvent(event)
    const keyupHandler = (event) => this.processKeyEvent(event)
    this._eventListeners.keydown = keydownHandler
    this._eventListeners.keyup = keyupHandler
    document.addEventListener("keydown", keydownHandler)
    document.addEventListener("keyup", keyupHandler)
  }

  processKeyEvent(event) {
    const key = event.key === " " || event.code === "Space" ? "Space" : event.key
    this.keys[key] = event.type === "keydown"
    if (this.keys[key] && (key === "Space" || key === "ArrowUp" || key === "w")) {
      verbose("PhysicsEngine", `Key pressed: ${key}`)
    }
  }

  removeEventListeners() {
    if (this._eventListeners.keydown) {
      document.removeEventListener("keydown", this._eventListeners.keydown)
      this._eventListeners.keydown = null
    }
    if (this._eventListeners.keyup) {
      document.removeEventListener("keyup", this._eventListeners.keyup)
      this._eventListeners.keyup = null
    }
  }

  update() {
    if (this.isPaused || !this.player) return

    const currentTime = Date.now()
    const deltaTime = currentTime - this.lastUpdateTime
    this.lastUpdateTime = currentTime

    // Process jump input
    this.processJumpInput(currentTime)

    // Process death
    if (this.isDead) {
      this.handleDeath()
      return
    }

    // Process movement input
    this.handleInput()

    // Apply physics based on mode
    this.applyPhysics(deltaTime)

    // Process collisions
    this.handleCollisions()

    // Update player state
    this.player.update(deltaTime)

    // Update render engine with player position
    this.renderEngine.updatePlayerPosition(this.player, this.player.rotation)
    verbose(
      "PhysicsEngine",
      "Calling updatePlayerPosition: x=",
      this.player.x,
      "y=",
      this.player.y,
      "rotation=",
      this.player.rotation,
    )

    // Process lane switching in clipper mode
    this.processLaneSwitching(currentTime)
  }

  /**
   * Process jump input from keyboard and execute jump if conditions are met
   * @param {number} currentTime - Current game time in milliseconds
   */
  processJumpInput(currentTime) {
    // Check if any jump keys are pressed
    const jumpKeyPressed = this.keys["Space"] || this.keys["ArrowUp"] || this.keys["w"]

    // Determine if jump is possible based on player state and timing
    const canJump = this.player.canJump(this.coyoteTime, currentTime)
    const bufferTimeOK = currentTime - this.lastJumpPressTime >= this.jumpBufferTime || this.lastJumpPressTime === 0

    // Log current player state for debugging
    verbose(
      "PhysicsEngine",
      `Current player mode: ${this.player.mode}, isOnPlatform: ${this.player.isOnPlatform}, isJumping: ${this.player.isJumping}`,
    )

    // Execute jump if all conditions are met
    if (jumpKeyPressed && canJump && bufferTimeOK) {
      this.lastJumpPressTime = currentTime
      if (this.player.jump() && this.audioManager) {
        this.audioManager.playJumpSound()
        verbose("PhysicsEngine", `Jump executed: vy=${this.player.vy}, jumpForce=${this.player.jumpForce}`)
      }
    }
    // Log failed jump attempts for debugging
    else if (jumpKeyPressed) {
      verbose(
        "PhysicsEngine",
        `Jump attempt ignored: keys=${jumpKeyPressed}, canJump=${canJump}, ` +
          `jumpsRemaining=${this.player.jumpsRemaining}, doubleJumpAvailable=${this.player.doubleJumpAvailable}, ` +
          `bufferTime=${currentTime - this.lastJumpPressTime}, ` +
          `coyoteTime=${currentTime - this.player.lastGroundedTime}`,
      )
    }
  }

  processLaneSwitching(currentTime) {
    if (this.player.mode === "clipper") {
      if (
        (this.keys["ArrowUp"] || this.keys["w"]) &&
        currentTime - this.lastLaneSwitchTime >= this.player.laneSwitchDelay
      ) {
        if (this.player.switchLane(-1)) {
          this.lastLaneSwitchTime = currentTime
        }
      }

      if (
        (this.keys["ArrowDown"] || this.keys["s"]) &&
        currentTime - this.lastLaneSwitchTime >= this.player.laneSwitchDelay
      ) {
        if (this.player.switchLane(1)) {
          this.lastLaneSwitchTime = currentTime
        }
      }
    }
  }

  handleInput() {
    if (!this.player || this.isDead || this.isComplete) return

    if (this.player.mode === "classic") {
      this.player.vx = 0
    } else if (this.player.mode === "clipper") {
      if (this.keys["Space"]) {
        this.player.startFreeMove()
      }
      if (!this.keys["Space"]) {
        this.player.endFreeMove()
      }
    }
  }

  /**
   * Apply physics calculations based on player mode
   * @param {number} deltaTime - Time elapsed since last frame in milliseconds
   */
  applyPhysics(deltaTime) {
    const p = this.player

    // Apply mode-specific physics
    if (p.mode === "classic") {
      // Classic mode: platformer physics with gravity and horizontal movement

      // Apply gravity if not on platform
      if (!p.isOnPlatform) {
        p.vy += this.gravity
        // Limit fall speed to prevent tunneling through platforms
        if (p.vy > this.maxFallSpeed) p.vy = this.maxFallSpeed
      }

      // Apply horizontal movement based on facing direction
      p.vx = this.moveSpeed * p.facing
    } else if (p.mode === "clipper") {
      // Clipper mode: lane-based movement with different vertical behavior

      // Apply horizontal movement based on facing direction
      p.vx = this.moveSpeed * p.facing

      // Apply vertical movement based on free-moving state and lane
      if (p.isFreeMoving) {
        // Top lane: move upward
        if (p.lane === 0) {
          p.vy = -this.moveSpeed * 2
          p.y = Math.max(0, p.y + p.vy) // Prevent going above top of screen
        }
        // Bottom lane: move downward
        else if (p.lane === 2) {
          p.vy = this.moveSpeed * 2
          // Only constrain to floor level, not upper bounds
          p.y = Math.min(this.groundLevel - p.height, p.y + p.vy)
          p.vy = 0
        }
      }
      // Not free-moving: snap to lane position
      else {
        p.vy = 0
        p.y = p.lanePositions[p.lane]
      }
    }

    // Apply velocities to position
    p.x += p.vx
    p.y += p.vy

    // Check if player is at or below floor level
    const floorPosition = this.groundLevel - p.height
    const wasConstrained = p.y > floorPosition
    p.y = Math.min(floorPosition, p.y)

    // Explicitly set isOnPlatform if the player is on the floor
    // Using a small epsilon value to handle floating point precision issues
    const EPSILON = 0.001
    if (wasConstrained || Math.abs(p.y - floorPosition) < EPSILON) {
      // Reset player state for landing on floor
      p.vy = 0
      p.isOnPlatform = true
      p.isJumping = false
      p.jumpsRemaining = 2
      p.doubleJumpAvailable = true
      p.lastGroundedTime = Date.now()
      p.rotation = 0
      verbose("PhysicsEngine", "Player on floor: explicitly setting isOnPlatform=true")
    }
  }

  /**
   * Handle player death
   * - Shows game over screen or auto-restarts based on settings
   * - Pauses all game components
   * - Handles audio state
   * - Uses Player.reset() to reset player state
   */
  // Track if death sequence is already running
  isDying = false

  async handleDeath() {
    // Prevent multiple death sequences
    if (this.isDying) {
      verbose("PhysicsEngine", "Death sequence already in progress")
      return
    }

    this.isDying = true

    try {
      // Calculate respawn position slightly above floor level
      const floorLevel = this.levelMatrix.length * 0.95

      // Store player position and color for the explosion
      const playerX = (this.player.x + 0.5) * this.renderEngine.blockSize
      const playerY = (this.player.y + 0.5) * this.renderEngine.blockSize
      const explosionColor = this.lastHazardColor || "#FF0000"

      verbose("PhysicsEngine", "Player died at:", playerX, playerY, "color:", explosionColor)
      // Create explosion effect asynchronously
      const createExplosion = () => {
        return new Promise((resolve) => {
          if (this.renderEngine && this.renderEngine.particleSystem) {
            // Create explosion with hazard color or default to red
            // Using a larger radius (50px) for the explosion
            this.renderEngine.particleSystem.createExplosion(
              { x: playerX, y: playerY }, // Pass position directly
              explosionColor,
              15, // Particle count
              50, // Max radius in pixels
            )

            // Resolve after a short delay to ensure particles are created
            setTimeout(resolve, 300) // Increased delay to allow particles to animate
          } else {
            resolve()
          }
        })
      }

      // Start the explosion animation and wait for it to complete
      await createExplosion()

      // Reset player state using the built-in reset method
      this.player.reset()
    } catch (e) {
      error("PhysicsEngine", "Error in death sequence:", e)
    } finally {
      // Always ensure we reset the dying flag, even if there was an error
      this.isDying = false
    }

    // Reset game state
    this.isComplete = false

    // Play death sound and handle music behavior if audio manager is available
    if (this.audioManager) {
      this.audioManager.playDeathSound()

      // Handle music restart/continue behavior based on restartMusicOnDeath setting
      if (this.audioManager.restartMusicOnDeath) {
        // Restart music from beginning
        this.audioManager.backgroundMusicTime = 0
      } else {
        // Continue from current position
        if (this.audioManager.backgroundMusic) {
          this.audioManager.backgroundMusicTime = this.audioManager.backgroundMusic.currentTime
        }
      }

      // Pause audio
      if (!this.audioManager.isMuted) {
        this.audioManager.pauseBackgroundMusic()
      }
    }

    // Reset the display before showing game over or restarting
    this.resetDisplay()

    // Show game over screen if auto restart is disabled
    if (!window.autoRestart) {
      const gameOverScreen = document.getElementById("gameOverScreen")
      if (gameOverScreen) {
        gameOverScreen.style.display = "block"
      }
    } else {
      // Add a small delay before auto-restarting to ensure particles are visible
      setTimeout(() => {
        // Only restart if we're still in a dead state
        if (this.isDead) {
          window.restartGame()
        }
      }, 500)
    }

    verbose(
      "PhysicsEngine",
      "Player died: repositioned at floor level",
      this.player.y,
      "rotation =",
      this.player.rotation,
      "jumpRotationDirection =",
      this.player.jumpRotationDirection,
    )
  }

  /**
   * Handle all collision detection and resolution for the player
   * Checks for level completion, hazards, and mode-specific collisions
   */
  handleCollisions() {
    // Reset game state flags at the start of collision detection
    const p = this.player

    // If already dead, don't process collisions
    if (this.isDead) {
      return
    }

    // Reset game state flags at the start of collision detection
    this.isDead = false
    this.isComplete = false

    // Helper function to get blocks at relative positions from player
    const blockAt = (dx, dy) => this.getBlockAt(p.x + dx, p.y + dy)

    // Get blocks at key positions relative to player
    const blockBelow = blockAt(0, p.height / 2 + 0.01) // Just below player's feet
    const blockAbove = blockAt(0, -p.height / 2 - 0.1) // Just above player's head
    const blockCenter = blockAt(0, 0) // At player's center

    // Check for level completion (exit portal, etc.)
    if (this.checkForLevelCompletion(blockCenter)) {
      return // Exit early if level is complete
    }

    // Check for modifier activation at player's center
    if (!this.isDead && blockCenter?.isModifier && !blockCenter._activated) {
      this.activateModifier(blockCenter)
      blockCenter._activated = true
      this.activeModifiers.add(blockCenter)
    }

    // Clean up active modifiers when player moves away
    if (this.activeModifiers.size > 0) {
      const playerCenter = { x: p.x + 0.5, y: p.y + 0.5 }
      for (const modifier of this.activeModifiers) {
        const distance = Math.sqrt(
          Math.pow((modifier.x || 0) + 0.5 - playerCenter.x, 2) + Math.pow((modifier.y || 0) + 0.5 - playerCenter.y, 2),
        )
        if (distance > 1.5) {
          // Reset when player moves away
          modifier._activated = false
          this.activeModifiers.delete(modifier)
        }
      }
    }

    // Check for hazard collision (spikes, enemies, etc.)
    const hazardBlock = this.checkForHazardCollision(blockCenter, blockBelow)
    if (hazardBlock && !this.isDead) {
      // Only trigger if not already dead
      this.isDead = true
      this.lastHazardColor = hazardBlock.appearance?.color?.base || "#FF0000" // Store hazard color or default to red

      // Start the death sequence
      this.handleDeath()
        .then(() => {
          // After death animation completes, reset the death state
          this.isDead = false
        })
        .catch((error) => {
          console.error("Error in death sequence:", error)
          this.isDead = false
        })

      return // Exit early if player died
    }

    // Handle mode-specific collisions
    if (p.mode === "classic") {
      this.handleClassicModeCollisions(blockBelow, blockAbove)
    }

    // Handle trigger collision
    if (blockCenter && blockCenter.collision === "trigger" && isObjectActive(blockCenter) && p.teleportCooldown <= 0) {
      this.handleTriggerCollision(blockCenter)
    }
  }

  checkForLevelCompletion(blockCenter) {
    if (blockCenter && blockCenter.type === BLOCK_TYPE.FINISH) {
      this.isComplete = true
      debug("PhysicsEngine", "Level complete: reached finish line")

      // Pause the game and animations
      if (this.renderEngine) {
        this.renderEngine.isPaused = true
      }

      if (this.audioManager) {
        this.audioManager.playCompletionSound()
      }
      return true
    }
    return false
  }

  checkForHazardCollision(blockCenter, blockBelow) {
    let hazardBlock = null

    if (blockCenter && blockCenter.collision === "hazard" && isObjectActive(blockCenter)) {
      hazardBlock = blockCenter
    } else if (blockBelow && blockBelow.collision === "hazard" && isObjectActive(blockBelow)) {
      hazardBlock = blockBelow
    }

    if (hazardBlock) {
      debug("PhysicsEngine", "Player died due to hazard")
      return hazardBlock // Return the hazard block for color information
    }
    return null
  }

  handleClassicModeCollisions(blockBelow, blockAbove) {
    const p = this.player

    // Handle landing on platform
    if (
      blockBelow &&
      (blockBelow.collision === "solid" || blockBelow.collision === "sticky") &&
      isObjectActive(blockBelow)
    ) {
      p.y = Math.floor(p.y + p.height / 2) - p.height / 2
      p.vy = 0
      p.isOnPlatform = true
      p.isJumping = false
      p.jumpsRemaining = 2
      p.doubleJumpAvailable = true
      p.lastGroundedTime = Date.now()
      p.rotation = 0
      this.lastJumpPressTime = 0

      if (blockBelow.collision === "sticky") {
        p.vx *= 0.5
      }

      verbose(
        "PhysicsEngine",
        "Landed on platform: jumpsRemaining =",
        p.jumpsRemaining,
        "doubleJumpAvailable =",
        p.doubleJumpAvailable,
        "rotation =",
        p.rotation,
        "jumpRotationDirection =",
        p.jumpRotationDirection,
      )
    } else if (p.y + p.height / 2 < this.groundLevel) {
      if (p.isOnPlatform) {
        p.isOnPlatform = false
      }
    }

    // Handle hitting ceiling
    if (
      blockAbove &&
      (blockAbove.collision === "solid" || blockAbove.collision === "sticky") &&
      isObjectActive(blockAbove) &&
      p.vy < 0
    ) {
      p.vy = 0
      if (blockAbove.collision === "sticky") {
        p.vx *= 0.5
      }
    }

    // Handle landing on ground
    if (p.y + p.height / 2 > this.groundLevel && p.vy > 0 && !blockBelow) {
      // Precise positioning to ensure player sits exactly on the visual floor
      p.y = this.groundLevel - p.height / 2
      p.vy = 0
      p.isOnPlatform = true
      p.isJumping = false
      p.jumpsRemaining = 2
      p.doubleJumpAvailable = true
      p.lastGroundedTime = Date.now()
      p.rotation = 0 // Force rotation to zero immediately on landing
      this.lastJumpPressTime = 0

      verbose(
        "PhysicsEngine",
        "Landed on ground: jumpsRemaining =",
        p.jumpsRemaining,
        "doubleJumpAvailable =",
        p.doubleJumpAvailable,
        "rotation =",
        p.rotation,
        "jumpRotationDirection =",
        p.jumpRotationDirection,
      )
    }
  }

  handleTriggerCollision(block) {
    const p = this.player

    switch (block.type) {
      case BLOCK_TYPE.TELEPORTER:
        this.handleTeleporterCollision(block)
        break

      case BLOCK_TYPE.TELEPORT_START:
      case BLOCK_TYPE.TELEPORT_END:
        this.handleTeleportPadCollision(block)
        break

      case BLOCK_TYPE.TRIGGER:
        this.handleGroupTrigger(block)
        break

      case BLOCK_TYPE.UNLOCK_ORB:
        this.handleUnlockOrbCollision(block)
        break

      case BLOCK_TYPE.CLIPPER_MODE:
        p.setMode("clipper")
        debug("PhysicsEngine", "Switched to clipper mode")
        break

      case BLOCK_TYPE.CLASSIC_MODE:
        p.setMode("classic")
        debug("PhysicsEngine", "Switched to classic mode")
        if (block.group) {
          triggerGroup(block.group, this.levelMatrix, p, cameraManager)
        }
        break

      case BLOCK_TYPE.LEFT_ORB:
        p.setFacing(-1)
        debug("PhysicsEngine", "Player facing left from orb, set jumpRotationDirection = -1")
        break

      case BLOCK_TYPE.RIGHT_ORB:
        p.setFacing(1)
        debug("PhysicsEngine", "Player facing right from orb, set jumpRotationDirection = 1")
        break

      case BLOCK_TYPE.FINISH:
        this.isComplete = true
        debug("PhysicsEngine", "Level complete!")
        break
    }
  }

  handleTeleporterCollision(block) {
    const p = this.player
    const angle = ((block.transform.rotation || 0) * Math.PI) / 180
    const distance = 100 / 32

    if (angle === 0) {
      p.y -= distance
    } else {
      p.x += Math.cos(angle) * distance * p.facing
      p.y += Math.sin(angle) * distance
    }

    // Only limit the player's vertical position to the ground level
    p.y = Math.min(this.groundLevel - p.height, p.y)
    p.teleportCooldown = 15
  }

  handleTeleportPadCollision(block) {
    const p = this.player
    const target = getTeleportTarget(block, this.levelMatrix)

    if (target) {
      p.x = target.x + 0.5
      // Only limit the player's vertical position to the ground level
      p.y = Math.min(this.groundLevel - p.height, target.y + 0.5)
      p.teleportCooldown = 15
    }
  }

  handleGroupTrigger(block) {
    const p = this.player

    if (block.group) {
      triggerGroup(block.group, this.levelMatrix, p, cameraManager)
      console.log(`Triggered group ${block.group}`)
    } else {
      debug("PhysicsEngine", "Triggered groupless trigger block")
    }
  }

  handleUnlockOrbCollision(block) {
    const p = this.player

    if (block.group && !this.unlockedGroups.has(block.group)) {
      handleUnlockOrb(block, Math.floor(p.x), Math.floor(p.y), this.levelMatrix, p, cameraManager)
      this.unlockedGroups.add(block.group)
      console.log(`Unlocked group ${block.group}`)
    }
  }

  getBlockAt(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    verbose("PhysicsEngine", `getBlockAt: x=${x}, y=${y}, xi=${xi}, yi=${yi}`)

    // Modified bounds checking: allow a reasonable amount of space above visible area for jumps
    // Only check if y is extremely negative or below ground level
    if (yi < -10 || yi >= this.levelMatrix.length) {
      // Only log extreme cases to avoid console spam during normal jumps
      if (yi < -5) {
        debug("PhysicsEngine", `Out of vertical bounds: yi=${yi}`)
      }
      return null
    }

    // Handle negative y indices (above the visible level) by returning null
    // This allows jumping above the level without errors
    if (yi < 0) {
      return null
    }

    // Handle horizontal wraparound for level matrix access
    const wrappedXi = ((xi % this.levelMatrix[0].length) + this.levelMatrix[0].length) % this.levelMatrix[0].length

    return this.levelMatrix[yi][wrappedXi]
  }

  reset() {
    this.player.reset()
    this.isDead = false
    this.isComplete = false
    this.activeModifiers.clear()
    this.lastJumpPressTime = 0
    this.renderEngine.updatePlayerPosition(this.player, this.player.rotation)
    verbose(
      "PhysicsEngine",
      "PhysicsEngine reset: player at floor level",
      this.player.y,
      "rotation =",
      this.player.rotation,
      "jumpRotationDirection =",
      this.player.jumpRotationDirection,
    )
    debug("PhysicsEngine", "PhysicsEngine reset complete.")
    this.resetDisplay()
  }

  cleanup() {
    this.stopGameLoop()
    this.removeEventListeners()
    this.player.cleanup()
    this.isDead = false
    this.isComplete = false
    this.keys = {}
    this.gravity = PHYSICS_CONSTANTS.GRAVITY
    this.maxFallSpeed = PHYSICS_CONSTANTS.MAX_FALL_SPEED
    this.moveSpeed = PHYSICS_CONSTANTS.MOVE_SPEED
    this.lastJumpPressTime = 0
  }

  /**
   * Reset all visual elements and effects
   */
  resetDisplay() {
    // Reset camera effects
    if (this.cameraManager) {
      this.cameraManager.resetEffects()
    }

    // Reset any active modifiers
    this.activeModifiers.clear()

    // Reset render engine if available
    if (this.renderEngine) {
      // Reset any visual effects in the render engine
      if (this.renderEngine.particleSystem) {
        this.renderEngine.particleSystem.reset()
      }
    }

    // Reset any other visual states
    this.isDying = false
    this.lastLaneSwitchTime = 0
  }

  resetReferences() {
    this.player = null
    this.levelMatrix = null
    this.renderEngine = null
    debug("physicsEngine", "All references reset.")
  }

  stopGameLoop() {
    debug("physicsEngine", "Stopping game loop (no-op)")
  }

  updateMatrix(newMatrix) {
    debug("PhysicsEngine", "Matrix updated.")
    this.levelMatrix = newMatrix
  }

  // Pause/resume the physics engine
  pause() {
    this.isPaused = true
    debug("PhysicsEngine", "Physics engine paused.")
  }

  resume() {
    this.isPaused = false
    this.lastUpdateTime = Date.now() // Reset time to avoid large delta on resume
    debug("PhysicsEngine", "Physics engine resumed.")
  }

  /**
   * Activate a modifier's effect
   * @param {Object} modifier - The modifier to activate
   */
  activateModifier(modifier) {
    if (!modifier?.isModifier) return

    verbose("PhysicsEngine", `Activated modifier type ${modifier.modifierType}`, modifier.params)

    // Apply modifier effect based on type
    switch (modifier.modifierType) {
      case 21: // Zoom
        this.cameraManager.zoomTo(modifier.params.level || 1.5, modifier.params.duration || 2)
        break
      case 22: // Shake
        this.cameraManager.shake(modifier.params.intensity || 15, modifier.params.duration || 2)
        break
      case 23: // Tilt
        this.cameraManager.tilt(
          modifier.params.angle || 15,
          modifier.params.direction || "left",
          modifier.params.duration || 3,
        )
        break
      case 24: // Pan
        this.cameraManager.pan(
          modifier.params.offsetX || 300, // Increased from 100
          modifier.params.offsetY || 150, // Added vertical offset
          modifier.params.duration || 3, // Increased from 2
        )
        break
      case 25: // Time Warp
        timeManager.setTimeScale(modifier.params.scale || 0.3) // More extreme slow motion
        if (modifier.params.duration) {
          setTimeout(
            () => timeManager.resetTimeScale(),
            modifier.params.duration * 1000 || 3000, // Default 3 seconds if not specified
          )
        }
        break
      default:
        warn("PhysicsEngine", `Unknown modifier type: ${modifier.modifierType}`)
    }

    // Notify render engine for visual feedback
    if (this.renderEngine?.showModifierActivation) {
      this.renderEngine.showModifierActivation(modifier)
    }
  }
}

export { Player, PhysicsEngine, PHYSICS_CONSTANTS, BLOCK_TYPE }
