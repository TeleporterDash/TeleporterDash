import { warn, error, debug, verbose } from "./logManager.js"

/**
 * @fileoverview Enhanced visual effects engine for PIXI.js applications
 * Includes optimized particle systems and visual distortion effects
 */

// ========================================================================
// Configuration Objects
// ========================================================================

/**
 * Standard particle effect configurations
 * @type {Object}
 */
const PARTICLE_CONFIGS = Object.freeze({
  sparkle: {
    scale: { start: 0.8, end: 1.2 },
    color: { start: 0xffffff, end: 0x000000 },
    speed: { x: 100, y: 100 },
    life: 1.5,
    size: 5,
  },
  wave: {
    scale: { start: 0.5, end: 1.0 },
    color: { start: 0x00ffff, end: 0x000000 },
    speed: { x: 50, y: 50 },
    life: 2.5,
    size: 4,
  },
  shock: {
    scale: { start: 0.8, end: 0.0 },
    color: { start: 0xff0000, end: 0x000000 },
    speed: { x: 150, y: 150 },
    life: 1.0,
    size: 6,
  },
  explosion: {
    scale: { start: 1.0, end: 0.2 },
    color: { start: 0xff9900, end: 0xff0000 },
    speed: { x: 200, y: 200 },
    life: 0.5,
    size: 6,
  },
})

/**
 * Standard distortion effect configurations
 * @type {Object}
 */
const DISTORTION_CONFIGS = Object.freeze({
  wave: {
    amplitude: 30,
    speed: 1000,
    radius: 100,
    wavelength: 200,
  },
  ripple: {
    amplitude: 10,
    speed: 2000,
    radius: 50,
    wavelength: 100,
    brightness: 1.2,
  },
  twist: {
    angle: Math.PI / 2,
    radius: 30,
    speed: 0.2,
  },
})

// ========================================================================
// Utility Functions
// ========================================================================

/**
 * Validates if PIXI.js is available and has the required features
 * @returns {boolean} True if PIXI is available with required features
 */
function validatePixiEnvironment() {
  if (!window.PIXI) {
    error("effectEngine", "PIXI.js is not loaded")
    return false
  }

  if (!window.PIXI.Graphics) {
    error("effectEngine", "PIXI.Graphics is not available")
    return false
  }

  if (!window.PIXI.Container) {
    error("effectEngine", "PIXI.Container is not available")
    return false
  }

  return true
}

/**
 * Creates a ripple displacement texture for distortion effects
 * @returns {PIXI.Texture} The generated texture
 */
export function createRippleTexture() {
  if (!validatePixiEnvironment()) return null

  const canvas = document.createElement("canvas")
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext("2d")

  if (!ctx) {
    error("effectEngine", "Failed to get 2D context for ripple texture")
    return null
  }

  // Create a ripple pattern centered at (128, 128)
  try {
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const dx = x - 128
        const dy = y - 128
        const dist = Math.sqrt(dx * dx + dy * dy)
        const angle = Math.atan2(dy, dx)
        const wave = Math.sin(dist * 0.05) * 10

        // Create a circular ripple pattern
        const r = Math.sin(angle * 2) * 128 + 128 + wave
        const g = Math.cos(angle * 2) * 128 + 128 + wave
        const b = 128

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
    return window.PIXI.Texture.from(canvas)
  } catch (e) {
    error("effectEngine", "Failed to create ripple texture", e)
    return null
  }
}

/**
 * Safely interpolates between two colors
 * @param {number} startColor - Starting color as hex number
 * @param {number} endColor - Ending color as hex number
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated color
 */
function interpolateColor(startColor, endColor, t) {
  try {
    // Extract color components
    const startR = (startColor >> 16) & 0xff
    const startG = (startColor >> 8) & 0xff
    const startB = startColor & 0xff

    const endR = (endColor >> 16) & 0xff
    const endG = (endColor >> 8) & 0xff
    const endB = endColor & 0xff

    // Interpolate
    const r = Math.floor(startR + (endR - startR) * t)
    const g = Math.floor(startG + (endG - startG) * t)
    const b = Math.floor(startB + (endB - startB) * t)

    // Convert back to hex
    return (r << 16) | (g << 8) | b
  } catch (e) {
    warn("effectEngine", "Color interpolation failed, returning white", e)
    return 0xffffff
  }
}

/**
 * Clamps a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// ========================================================================
// Distortion System
// ========================================================================

/**
 * Handles visual distortion effects on sprites
 */
export class DistortionSystem {
  /**
   * Creates a new distortion effect
   * @param {PIXI.Sprite} sprite - Target sprite
   * @param {string} type - Effect type ('wave', 'ripple', 'twist')
   * @param {number} intensity - Effect intensity
   */
  constructor(sprite, type, intensity) {
    this.sprite = sprite
    this.type = Object.prototype.hasOwnProperty.call(DISTORTION_CONFIGS, type) ? type : "wave"
    this.intensity = clamp(intensity || 1, 0, 3)
    this.time = 0
    this.filter = null
    this.active = false

    if (!validatePixiEnvironment()) {
      return
    }

    if (!window.PIXI.filters) {
      error("effectEngine", "PIXI filters not loaded")
      return
    }

    this.initialize()
  }

  /**
   * Initialize the distortion filter based on type
   */
  initialize() {
    // Set the center point for all effects
    const centerX = this.sprite.width / 2
    const centerY = this.sprite.height / 2

    try {
      switch (this.type) {
        case "wave":
          if (!window.PIXI.filters.ShockwaveFilter) {
            warn("effectEngine", "ShockwaveFilter not available")
            return
          }
          this.filter = new window.PIXI.filters.ShockwaveFilter()
          this.filter.center = { x: centerX, y: centerY }
          break

        case "ripple":
          if (!window.PIXI.filters.ShockwaveFilter) {
            warn("effectEngine", "ShockwaveFilter not available")
            return
          }
          this.filter = new window.PIXI.filters.ShockwaveFilter()
          this.filter.center = { x: centerX, y: centerY }
          break

        case "twist":
          if (!window.PIXI.filters.TwistFilter) {
            warn("effectEngine", "TwistFilter not available")
            return
          }
          this.filter = new window.PIXI.filters.TwistFilter()
          this.filter.offset = { x: centerX, y: centerY }
          break

        default:
          warn("effectEngine", `Unknown distortion type: ${this.type}`)
          return
      }

      if (this.filter) {
        // Store original filters to restore them later
        this.originalFilters = [...(this.sprite.filters || [])]
        this.sprite.filters = [...this.originalFilters, this.filter]
        this.updateConfig()
        this.active = true

        debug("effectEngine", `Created ${this.type} distortion effect with intensity ${this.intensity}`)
      }
    } catch (e) {
      error("effectEngine", `Failed to create distortion effect: ${e.message}`)
    }
  }

  /**
   * Update configuration parameters based on intensity
   */
  updateConfig() {
    if (!this.filter || !this.active) return

    const config = DISTORTION_CONFIGS[this.type]
    if (!config) return

    const intensity = this.intensity

    try {
      switch (this.type) {
        case "wave":
          this.filter.amplitude = config.amplitude * intensity
          this.filter.speed = config.speed
          this.filter.radius = config.radius * intensity
          this.filter.wavelength = config.wavelength
          break

        case "ripple":
          this.filter.amplitude = config.amplitude * intensity
          this.filter.speed = config.speed
          this.filter.radius = config.radius * intensity
          this.filter.wavelength = config.wavelength

          // Some implementations may not support brightness
          if (config.brightness && typeof this.filter.brightness !== "undefined") {
            this.filter.brightness = config.brightness
          }
          break

        case "twist":
          this.filter.angle = config.angle * intensity
          this.filter.radius = config.radius * intensity

          // Some implementations may have different names for the speed property
          if (typeof this.filter.speed !== "undefined") {
            this.filter.speed = config.speed
          } else if (typeof this.filter.animationSpeed !== "undefined") {
            this.filter.animationSpeed = config.speed
          }
          break
      }
    } catch (e) {
      warn("effectEngine", `Error updating distortion config: ${e.message}`)
    }
  }

  /**
   * Update the distortion effect
   * @param {number} deltaTime - Time since last update in seconds
   */
  update(deltaTime) {
    if (!this.filter || !this.active) return

    // Time is already in seconds from render engine
    this.time += deltaTime

    try {
      // Update center point for all effects
      const centerX = this.sprite.width / 2
      const centerY = this.sprite.height / 2

      if (this.type === "wave" || this.type === "ripple") {
        this.filter.center = { x: centerX, y: centerY }

        // Update time for shockwave filter
        if (typeof this.filter.time !== "undefined") {
          // For shockwave, we want to loop the effect every 2 seconds
          this.filter.time = this.time % 2
        }
      } else if (this.type === "twist") {
        // Update the center point for twist filter
        if (typeof this.filter.offset !== "undefined") {
          this.filter.offset = { x: centerX, y: centerY }
        } else if (typeof this.filter.center !== "undefined") {
          this.filter.center = { x: centerX, y: centerY }
        }
      }
    } catch (e) {
      warn("effectEngine", `Error in distortion update: ${e.message}`)
    }
  }

  /**
   * Clean up resources used by this effect
   */
  cleanup() {
    if (!this.sprite || !this.active) return

    try {
      // Restore original filters if they exist
      if (this.originalFilters) {
        this.sprite.filters = this.originalFilters.length > 0 ? this.originalFilters : null
      } else {
        this.sprite.filters = null
      }

      this.active = false
      debug("effectEngine", `Cleaned up ${this.type} distortion effect`)
    } catch (e) {
      error("effectEngine", `Error cleaning up distortion: ${e.message}`)
    }
  }

  /**
   * Change the effect intensity
   * @param {number} newIntensity - New intensity value
   */
  setIntensity(newIntensity) {
    this.intensity = clamp(newIntensity, 0, 3)
    this.updateConfig()
  }
}

// ========================================================================
// Particle System
// ========================================================================

/**
 * Manages and renders particle effects
 */
export class ParticleSystem {
  /**
   * Create a new particle system
   * @param {PIXI.Container} parent - Parent container for particles
   * @param {Object} options - Configuration options
   */
  constructor(parent, options = {}) {
    if (!validatePixiEnvironment()) {
      error("effectEngine", "Cannot initialize ParticleSystem: PIXI environment invalid")
      return
    }

    // Initialize container
    this.container = new window.PIXI.Container()
    this.container.zIndex = options.zIndex || 10 // Make particles render above other elements

    if (parent && parent.addChild) {
      parent.addChild(this.container)
    } else {
      warn("effectEngine", "Invalid parent container, particles may not render")
    }

    // Initialize properties
    this.particles = []
    this.particlePool = []
    this.maxParticles = options.maxParticles || 500
    this.poolSize = options.poolSize || 100
    this.time = performance.now()
    this.isPaused = false

    // Initialize particle pool
    this._initializeParticlePool()

    debug(
      "effectEngine",
      `ParticleSystem initialized with maxParticles=${this.maxParticles}, poolSize=${this.poolSize}`,
    )
  }

  /**
   * Initialize pool of reusable particle objects
   * @private
   */
  _initializeParticlePool() {
    for (let i = 0; i < this.poolSize; i++) {
      const particle = new window.PIXI.Graphics()
      particle.visible = false
      this.container.addChild(particle)
      this.particlePool.push(particle)
    }
    debug("effectEngine", `Created particle pool with ${this.poolSize} particles`)
  }

  /**
   * Get a particle from the pool or create a new one
   * @private
   * @returns {PIXI.Graphics} A particle object
   */
  _getParticle() {
    // Check if we've hit the maximum particle count
    if (this.particles.length >= this.maxParticles) {
      // Find the oldest particle and recycle it
      let oldestIndex = 0
      let oldestLife = 0

      for (let i = 0; i < this.particles.length; i++) {
        if (this.particles[i].life > oldestLife) {
          oldestLife = this.particles[i].life
          oldestIndex = i
        }
      }

      const oldParticle = this.particles[oldestIndex]
      // Reset the particle for reuse
      oldParticle.life = 0
      oldParticle.visible = true
      return oldParticle
    }

    // Try to get a particle from the pool
    if (this.particlePool.length > 0) {
      const particle = this.particlePool.pop()
      particle.visible = true
      this.particles.push(particle)
      return particle
    }

    // Create a new particle if pool is empty
    const particle = new window.PIXI.Graphics()
    this.container.addChild(particle)
    this.particles.push(particle)
    return particle
  }

  /**
   * Return a particle to the pool
   * @private
   * @param {PIXI.Graphics} particle - Particle to recycle
   * @param {number} index - Index in the particles array
   */
  _recycleParticle(particle, index) {
    if (!particle) return

    // Reset particle properties
    particle.clear()
    particle.visible = false
    particle.x = 0
    particle.y = 0
    particle.scale.set(1)
    particle.alpha = 1
    particle.vx = 0
    particle.vy = 0
    particle.life = 0
    particle.maxLife = 0
    particle.type = null

    // Remove from active particles
    if (index !== undefined) {
      this.particles.splice(index, 1)
    } else {
      const particleIndex = this.particles.indexOf(particle)
      if (particleIndex !== -1) {
        this.particles.splice(particleIndex, 1)
      }
    }

    // Add to pool if it's not full
    if (this.particlePool.length < this.poolSize) {
      this.particlePool.push(particle)
    } else {
      // Remove from container if pool is full
      if (particle.parent) {
        particle.parent.removeChild(particle)
      }
      particle.destroy({ children: true })
    }
  }

  /**
   * Emit particles at a sprite's position
   * @param {PIXI.Sprite} sprite - Source sprite
   * @param {string} type - Particle type from PARTICLE_CONFIGS
   * @param {number} intensity - Emission intensity multiplier
   * @param {number|string} color - Custom color (hex number or string)
   */
  emit(sprite, type, intensity = 1, color = null) {
    if (!sprite) {
      warn("effectEngine", "Cannot emit particles: invalid sprite")
      return
    }

    if (!sprite.parent) {
      warn("effectEngine", "Cannot emit particles: sprite has no parent")
      return
    }

    // Validate and get particle config
    if (!Object.prototype.hasOwnProperty.call(PARTICLE_CONFIGS, type)) {
      debug("effectEngine", `Unknown particle type: ${type}, using sparkle instead`)
      type = "sparkle"
    }

    const config = PARTICLE_CONFIGS[type]
    debug("effectEngine", `Emitting particle of type ${type} with intensity ${intensity}`)

    // Convert color string to hex if needed
    let colorHex = color
    if (typeof color === "string" && color.startsWith("#")) {
      try {
        colorHex = Number.parseInt(color.replace("#", "0x"), 16)
      } catch (e) {
        warn("effectEngine", `Invalid color format: ${color}, using default`)
        colorHex = config.color.start
      }
    }

    // Use default color from config if none provided
    if (colorHex === null) {
      colorHex = config.color.start
    }

    // Get a particle from the pool
    const particle = this._getParticle()
    if (!particle) return

    try {
      // Draw the particle using consistent PIXI v8 API
      particle.clear()

      // Use circle method for simplicity and performance
      const size = config.size || 5
      particle.circle(0, 0, size)
      particle.fill({ color: colorHex, alpha: 1 })
      verbose("effectEngine", `Drawing particle with color: #${colorHex.toString(16).padStart(6, "0")}`)

      // Set initial properties
      particle.x = sprite.x
      particle.y = sprite.y
      particle.scale.set(config.scale.start)
      particle.alpha = 1

      // Calculate random velocity based on config and intensity
      particle.vx = (Math.random() - 0.5) * config.speed.x * intensity
      particle.vy = (Math.random() - 0.5) * config.speed.y * intensity

      // Set life and maxLife
      particle.life = 0
      particle.maxLife = config.life

      // Store type and custom color for update
      particle.type = type
      if (colorHex !== null) {
        particle.customColor = colorHex
      }
    } catch (e) {
      error("effectEngine", `Error creating particle: ${e.message}`)
      this._recycleParticle(particle)
    }
  }

  /**
   * Creates an explosion of particles at the specified position
   * @param {PIXI.Sprite|Object} sprite - The sprite or position object {x, y} to create explosion at
   * @param {string|number} color - Color for particles (hex string or number)
   * @param {number} count - Number of particles to emit
   * @param {number} maxRadius - Maximum radius for particle spread (in pixels)
   */
  createExplosion(sprite, color = "#FFFFFF", count = 10, maxRadius = 200) {
    if (!sprite) {
      warn("effectEngine", "Cannot create explosion: invalid sprite")
      return
    }

    // Convert color string to hex number if needed
    let colorHex = color
    if (typeof color === "string") {
      // Remove any leading # if present
      const hex = color.startsWith("#") ? color.slice(1) : color
      try {
        colorHex = Number.parseInt(hex, 16)
      } catch (e) {
        warn("effectEngine", `Invalid color format: ${color}, using white`)
        colorHex = 0xffffff
      }
    } else if (typeof color === "number") {
      // Ensure it's a valid color number
      colorHex = isNaN(color) ? 0xffffff : color & 0xffffff
    }

    // Extract position from sprite or use as coordinates
    const x = sprite.x || 0
    const y = sprite.y || 0

    if (this.container && !this.container.destroyed) {
      // Create multiple particles using the emit method with our custom config and color
      for (let i = 0; i < count; i++) {
        // Create a particle using the particle system's internal method
        const particle = this._getParticle()
        if (!particle) return

        try {
          // Calculate random angle and distance within maxRadius
          const angle = Math.random() * Math.PI * 2
          const distance = Math.random() * maxRadius

          // Set initial position
          particle.x = x + Math.cos(angle) * distance
          particle.y = y + Math.sin(angle) * distance

          // Set initial properties
          const config = PARTICLE_CONFIGS.explosion
          particle.scale.set(config.scale.start)
          particle.alpha = 1

          // Calculate random velocity
          const speed = 100 + Math.random() * 200 // Base speed + random variation
          particle.vx = Math.cos(angle) * speed
          particle.vy = Math.sin(angle) * speed

          // Set life and maxLife
          particle.life = 0
          particle.maxLife = config.life * (0.8 + Math.random() * 0.4) // Add some variation

          // Store type and custom color
          particle.type = "explosion"
          particle.customColor = colorHex

          // Draw the particle
          const size = config.size || 5
          particle.clear()
          particle.circle(0, 0, size)
          particle.fill({ color: colorHex, alpha: 1 })

          verbose("effectEngine", `Created explosion particle with color: #${colorHex.toString(16).padStart(6, "0")}`)
        } catch (e) {
          error("effectEngine", `Error creating explosion particle: ${e.message}`)
          this._recycleParticle(particle)
        }
      }
    } else {
      warn("effectEngine", "Cannot create explosion: container not available")
    }
  }

  /**
   * Update all particles in the system
   * @param {number} deltaTime - Time elapsed since last update in seconds
   */
  update(deltaTime) {
    // Handle deltaTime input
    let deltaTimeSeconds
    if (typeof deltaTime === "number" && deltaTime > 0) {
      // Convert from milliseconds to seconds if necessary
      deltaTimeSeconds = deltaTime > 0.1 ? deltaTime / 1000 : deltaTime
    } else {
      // Fallback to time difference calculation
      const currentTime = performance.now()
      deltaTimeSeconds = (currentTime - this.time) / 1000
      this.time = currentTime
    }

    // Cap delta time to avoid huge jumps
    deltaTimeSeconds = Math.min(deltaTimeSeconds, 0.1)

    if (this.isPaused) return

    // Update existing particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]
      if (!particle || !particle.visible) continue

      try {
        // Update position
        particle.x += particle.vx * deltaTimeSeconds
        particle.y += particle.vy * deltaTimeSeconds

        // Calculate life progress (0 to 1)
        const t = particle.life / particle.maxLife
        const config = PARTICLE_CONFIGS[particle.type] || PARTICLE_CONFIGS.sparkle

        // Update scale with clamping for safety
        const startScale = Math.max(0, config.scale.start)
        const endScale = Math.max(0, config.scale.end)
        const currentScale = startScale + t * (endScale - startScale)
        particle.scale.set(currentScale)

        // Update color - use custom color if available, otherwise use config color
        let hexColor
        if (particle.customColor !== undefined) {
          // If we have a custom color, use it directly
          hexColor = particle.customColor
        } else if (config.color && config.color.start && config.color.end) {
          // Otherwise use the config's color interpolation
          hexColor = interpolateColor(config.color.start, config.color.end, t)
        } else {
          // Fallback to white
          hexColor = 0xffffff
        }

        // Update particle appearance with new color
        const size = (config.size || 5) * particle.scale.x
        particle.clear()
        particle.circle(0, 0, size)
        particle.fill({ color: hexColor, alpha: 1 })

        // Update alpha with smooth fade-out
        particle.alpha = Math.max(0, Math.min(1, 1 - t))

        // Update life
        particle.life += deltaTimeSeconds

        // Check if particle should be recycled
        if (
          particle.alpha <= 0 ||
          particle.life >= particle.maxLife ||
          particle.x < -100 ||
          particle.x > window.innerWidth + 100 ||
          particle.y < -100 ||
          particle.y > window.innerHeight + 100
        ) {
          this._recycleParticle(particle, i)
        }
      } catch (e) {
        warn("effectEngine", `Error in particle update: ${e.message}`)
        this._recycleParticle(particle, i)
      }
    }
  }

  /**
   * Pause the particle system
   */
  pause() {
    this.isPaused = true
  }

  /**
   * Resume the particle system
   */
  resume() {
    this.isPaused = false
    this.time = performance.now() // Reset timer to prevent huge jumps
  }

  /**
   * Reset the particle system, clearing all particles
   */
  reset() {
    debug("effectEngine", "Resetting particle system")

    // Recycle all active particles
    while (this.particles.length > 0) {
      this._recycleParticle(this.particles[0], 0)
    }

    // Reset time and pause state
    this.time = performance.now()
    this.isPaused = false

    debug("effectEngine", "Particle system reset complete")
  }

  /**
   * Clean up resources used by this particle system
   */
  cleanup() {
    debug("effectEngine", "Cleaning up particle system")

    // Destroy all particles
    while (this.particles.length > 0) {
      const particle = this.particles.pop()
      this.container.removeChild(particle)
      particle.destroy({ children: true })
    }

    // Destroy pool particles
    while (this.particlePool.length > 0) {
      const particle = this.particlePool.pop()
      this.container.removeChild(particle)
      particle.destroy({ children: true })
    }

    // Remove container from parent
    if (this.container.parent) {
      this.container.parent.removeChild(this.container)
    }

    // Destroy the container itself
    this.container.destroy({ children: true })
    this.container = null

    debug("effectEngine", "Particle system cleanup complete")
  }
}
