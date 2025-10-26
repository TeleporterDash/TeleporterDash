import { warn, error, debug, verbose } from "./logManager"
import { gsap } from "gsap"
import { PixiPlugin } from "gsap/PixiPlugin"
import { clamp, random, sample } from "lodash"
import Color from "color"
import { 
  ShockwaveFilter, 
  TwistFilter,
  GlowFilter,
  DropShadowFilter
} from "pixi-filters"
import { DisplacementFilter, NoiseFilter, Application, Graphics,  Assets, Container, Sprite, Text, Texture } from 'pixi.js';
import 'pixi.js/advanced-blend-modes';

// Register GSAP PIXI plugin
gsap.registerPlugin(PixiPlugin)

/**
 * @fileoverview Unified visual effects engine for PIXI.js applications
 * Combines advanced particle systems, distortion effects, and visual enhancements
 * using GSAP, lodash, color, and pixi-filters for optimized performance
 */

// ========================================================================
// Configuration Objects
// ========================================================================

/**
 * Enhanced particle effect configurations with GSAP easing
 * @type {Object}
 */
const PARTICLE_CONFIGS: object = Object.freeze({
  sparkle: {
    scale: { start: 0.8, end: 1.2 },
    color: { start: "#ffffff", end: "#000000" },
    speed: { x: 100, y: 100 },
    life: 1.5,
    size: 5,
    ease: "power2.out",
    count: 8
  },
  wave: {
    scale: { start: 0.5, end: 1.0 },
    color: { start: "#00ffff", end: "#000000" },
    speed: { x: 50, y: 50 },
    life: 2.5,
    size: 4,
    ease: "sine.inOut",
    count: 12
  },
  shock: {
    scale: { start: 0.8, end: 0.0 },
    color: { start: "#ff0000", end: "#000000" },
    speed: { x: 150, y: 150 },
    life: 1.0,
    size: 6,
    ease: "power3.out",
    count: 15
  },
  explosion: {
    scale: { start: 1.0, end: 0.2 },
    color: { start: "#ff9900", end: "#ff0000" },
    speed: { x: 200, y: 200 },
    life: 0.5,
    size: 6,
    ease: "power2.out",
    count: 20
  },
  magic: {
    scale: { start: 0.3, end: 1.5 },
    color: { start: "#ff00ff", end: "#9900ff" },
    speed: { x: 75, y: 75 },
    life: 3.0,
    size: 3,
    ease: "elastic.out(1, 0.3)",
    count: 10
  }
})

/**
 * Enhanced distortion effect configurations
 * @type {Object}
 */
const DISTORTION_CONFIGS: object = Object.freeze({
  wave: {
    amplitude: 30,
    speed: 1000,
    radius: 100,
    wavelength: 200,
    filter: ShockwaveFilter
  },
  ripple: {
    amplitude: 10,
    speed: 2000,
    radius: 50,
    wavelength: 100,
    brightness: 1.2,
    filter: ShockwaveFilter
  },
  twist: {
    angle: Math.PI / 2,
    radius: 30,
    speed: 0.2,
    filter: TwistFilter
  },
  noise: {
    seed: Math.random(),
    noise: 0.5,
    filter: NoiseFilter
  },
  displacement: {
    scale: 20,
    filter: DisplacementFilter
  }
})

// ========================================================================
// Utility Functions
// ========================================================================


/**
 * Creates an optimized ripple displacement texture using PIXI Graphics
 * @param {number} size - Texture size (default: 256)
 * @returns {Texture} The generated texture
 */
export function createRippleTexture(size: number = 256): Texture {
  if(!Application) return null

  try {
    const graphics = new Graphics()
    const center = size / 2
    
    // Create concentric circles for ripple effect
    for (let i = 0; i < 10; i++) {
      const radius = (i / 10) * center
      const alpha = 1 - (i / 10)
      
      graphics.circle(center, center, radius)
      graphics.fill({ color: 0x8080ff, alpha: alpha * 0.3 })
    }
    
    const texture = Texture.from(graphics)
    texture.source.addressMode = "repeat"
    return texture
  } catch (e) {
    error("visualEffectsEngine", "Failed to create ripple texture", e)
    return null;
  }
}

/**
 * Creates a noise displacement texture for displacement effects
 * @param {number} width - Texture width (default: 128)
 * @param {number} height - Texture height (default: 128)
 * @returns {Sprite} The displacement sprite
 */
export function createDisplacementSprite(width: number = 128, height: number = 128): Sprite {
  if(!Application) return null;

  try {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = Math.random() * 255
        ctx.fillStyle = `rgb(${value},${value},${value})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
    const sprite = Sprite.from(canvas)
    sprite.texture.source.addressMode = "repeat"
    return sprite
  } catch (e) {
    error("visualEffectsEngine", "Failed to create displacement texture", e)
    return null
  }
}

/**
 * Advanced color interpolation using Color library
 * @param {string|number} startColor - Starting color
 * @param {string|number} endColor - Ending color  
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated color as hex number
 */
function interpolateColor(startColor: string | number, endColor: string | number, t: number): number {
  try {
    const start = Color(startColor)
    const end = Color(endColor)
    const mixed = start.mix(end, clamp(t, 0, 1))
    return parseInt(mixed.hex().replace('#', '0x'), 16)
  } catch (e) {
    warn("visualEffectsEngine", "Color interpolation failed, returning white", e)
    return 0xffffff
  }
}

/**
 * Get random color from a palette
 * @param {Array<string>} palette - Array of color strings
 * @returns {string} Random color from palette
 */
function getRandomColor(palette: Array<string> = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']): string {
  return sample(palette)
}

// ========================================================================
// Enhanced Distortion System
// ========================================================================

/**
 * Advanced distortion effects using pixi-filters and GSAP
 */
export class DistortionSystem {
  sprite: Sprite
  type: string
  intensity: number
  options: object
  filter: null
  active: boolean
  timeline: null
  originalFilters: null
  /**
   * Creates a new distortion effect
   * @param {Sprite} sprite - Target sprite
   * @param {string} type - Effect type ('wave', 'ripple', 'twist', 'noise', 'displacement')
   * @param {number} intensity - Effect intensity (0-3)
   * @param {Object} options - Additional options
   */
  constructor(sprite: Sprite, type: string, intensity: number = 1, options: object = {}) {
    this.sprite = sprite
    this.type = Object.prototype.hasOwnProperty.call(DISTORTION_CONFIGS, type) ? type : "wave"
    this.intensity = clamp(intensity, 0, 3)
    this.options = options
    this.filter = null
    this.active = false
    this.timeline = null
    this.originalFilters = null

    if(!Application) {
      error("visualEffectsEngine", "Cannot initialize DistortionSystem: PIXI environment invalid")
      return
    }

    this.initialize()
  }

  /**
   * Initialize the distortion filter with GSAP animations
   */
  initialize() {
    const config = DISTORTION_CONFIGS[this.type]
    const centerX = this.sprite.width / 2
    const centerY = this.sprite.height / 2

    try {
      // Create filter instance
      if (this.type === "displacement") {
        this.filter = new config.filter({ sprite: createDisplacementSprite() })
      } else {
        this.filter = new config.filter()
      }
      
      // Configure filter based on type
      this.configureFilter(config, centerX, centerY)
      
      // Apply filter to sprite
      this.originalFilters = this.sprite.filters ? [...this.sprite.filters] : []
      this.sprite.filters = [...this.originalFilters, this.filter]
      
      // Create GSAP timeline for animations
      this.createAnimationTimeline(config)
      
      this.active = true
      debug("visualEffectsEngine", `Created ${this.type} distortion with intensity ${this.intensity}`)
      
    } catch (e) {
      error("visualEffectsEngine", `Failed to create distortion effect: ${e.message}`)
    }
  }

  /**
   * Configure filter properties based on type
   * @param {Object} config - Filter configuration
   * @param {number} centerX - Center X coordinate
   * @param {number} centerY - Center Y coordinate
   */
  configureFilter(config: object, centerX: number, centerY: number) {
    const intensity = this.intensity

    if (!this.filter) return;

    switch (this.type) {
      case "wave":
      case "ripple":
        this.filter.center = [centerX, centerY]
        this.filter.amplitude = (config.amplitude || 30) * intensity
        this.filter.wavelength = config.wavelength || 200
        this.filter.speed = config.speed || 1000
        this.filter.radius = (config.radius || 100) * intensity
        if (config.brightness) this.filter.brightness = config.brightness
        break

      case "twist":
        this.filter.offset = [centerX, centerY]
        this.filter.radius = (config.radius || 30) * intensity
        this.filter.angle = (config.angle || Math.PI / 2) * intensity
        break

      case "noise":
        this.filter.seed = config.seed || Math.random()
        this.filter.noise = (config.noise || 0.5) * intensity
        break

      case "displacement":
        this.filter.scale.x = (config.scale || 20) * intensity
        this.filter.scale.y = (config.scale || 20) * intensity
        break
    }
  }

  /**
   * Create GSAP animation timeline for the effect
   * @param {Object} config - Filter configuration
   */
  createAnimationTimeline(config: object) {
    this.timeline = gsap.timeline({ repeat: -1, yoyo: true })

    switch (this.type) {
      case "wave":
      case "ripple":
        this.timeline.to(this.filter, {
          duration: 2,
          time: 1,
          ease: "sine.inOut"
        })
        break

      case "twist":
        this.timeline.to(this.filter, {
          duration: 4,
          angle: this.filter.angle * 2,
          ease: "power2.inOut"
        })
        break

      case "noise":
        this.timeline.to(this.filter, {
          duration: 1,
          seed: Math.random(),
          ease: "power1.inOut"
        })
        break

      case "displacement":
        this.timeline.to(this.filter.scale, {
          duration: 2,
          x: this.filter.scale.x * 1.5,
          y: this.filter.scale.y * 1.5,
          ease: "sine.inOut"
        })
        break
    }
  }

  /**
   * Update filter center position (for responsive effects)
   */
  updateCenter() {
    if (!this.filter || !this.active) return

    const centerX = this.sprite.width / 2
    const centerY = this.sprite.height / 2

    if (this.filter.center) {
      this.filter.center = [centerX, centerY]
    } else if (this.filter.offset) {
      this.filter.offset = [centerX, centerY]
    }
  }

  /**
   * Change effect intensity with smooth transition
   * @param {number} newIntensity - New intensity value
   * @param {number} duration - Transition duration
   */
  setIntensity(newIntensity: number, duration: number = 0.5) {
    const oldIntensity = this.intensity
    this.intensity = clamp(newIntensity, 0, 3)
    
    if (!this.filter || !this.active) return

    const config = DISTORTION_CONFIGS[this.type]
    const targetProps = {}

    // Calculate target properties based on new intensity
    switch (this.type) {
      case "wave":
      case "ripple":
        targetProps.amplitude = (config.amplitude || 30) * this.intensity
        targetProps.radius = (config.radius || 100) * this.intensity
        break

      case "twist":
        targetProps.angle = (config.angle || Math.PI / 2) * this.intensity
        targetProps.radius = (config.radius || 30) * this.intensity
        break

      case "noise":
        targetProps.noise = (config.noise || 0.5) * this.intensity
        break

      case "displacement":
        targetProps.x = (config.scale || 20) * this.intensity
        targetProps.y = (config.scale || 20) * this.intensity
        break
    }

    // Animate to new intensity
    gsap.to(this.filter.scale || this.filter, {
      duration: duration,
      ...targetProps,
      ease: "power2.out"
    })
  }

  /**
   * Pause the distortion effect
   */
  pause() {
    if (this.timeline) {
      this.timeline.pause()
    }
  }

  /**
   * Resume the distortion effect
   */
  resume() {
    if (this.timeline) {
      this.timeline.resume()
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (!this.active) return

    try {
      // Kill GSAP timeline
      if (this.timeline) {
        this.timeline.kill()
        this.timeline = null
      }

      // Restore original filters
      if (this.sprite && this.originalFilters !== null) {
        this.sprite.filters = this.originalFilters.length > 0 ? this.originalFilters : null
      }

      this.active = false
      debug("visualEffectsEngine", `Cleaned up ${this.type} distortion effect`)
    } catch (e) {
      error("visualEffectsEngine", `Error cleaning up distortion: ${e.message}`)
    }
  }
}

// ========================================================================
// Enhanced Particle System
// ========================================================================

/**
 * Advanced particle system using GSAP for animations
 */
export class ParticleSystem {
  container: any
  particles: never[]
  particlePool: never[]
  activeAnimations: Set<unknown>
  maxParticles: any
  poolSize: any
  isPaused: boolean
  /**
   * Create a new particle system
   * @param {Container} parent - Parent container
   * @param {Object} options - Configuration options
   */
  constructor(parent: Container, options: object = {}) {
    if(!Application) {
      error("visualEffectsEngine", "Cannot initialize ParticleSystem: PIXI environment invalid")
      return
    }

    this.container = new Container()
    this.container.zIndex = options.zIndex || 10
    this.container.sortableChildren = true

    if (parent && parent.addChild) {
      parent.addChild(this.container)
    } else {
      warn("visualEffectsEngine", "Invalid parent container")
    }

    this.particles = []
    this.particlePool = []
    this.activeAnimations = new Set()
    this.maxParticles = options.maxParticles || 500
    this.poolSize = options.poolSize || 100
    this.isPaused = false

    this._initializeParticlePool()
    debug("visualEffectsEngine", `ParticleSystem initialized with ${this.maxParticles} max particles`)
  }

  /**
   * Initialize reusable particle pool
   * @private
   */
  _initializeParticlePool() {
    for (let i = 0; i < this.poolSize; i++) {
      const particle = new Graphics()
      particle.visible = false
      particle.zIndex = random(1, 100)
      this.container.addChild(particle)
      this.particlePool.push(particle)
    }
  }

  /**
   * Get particle from pool with smart recycling
   * @private
   * @returns {Graphics} Particle object
   */
  _getParticle(): Graphics {
    if (this.particles.length >= this.maxParticles) {
      const oldestParticle = this.particles.shift()
      this._recycleParticle(oldestParticle)
    }

    let particle = this.particlePool.pop()
    if (!particle) {
      particle = new Graphics()
      particle.zIndex = random(1, 100)
      this.container.addChild(particle)
    }

    particle.visible = true
    this.particles.push(particle)
    return particle
  }

  /**
   * Return particle to pool
   * @private
   * @param {Graphics} particle - Particle to recycle
   */
  _recycleParticle(particle: Graphics) {
    if (!particle) return

    gsap.killTweensOf(particle)
    particle.clear()
    particle.visible = false
    particle.alpha = 1
    particle.scale.set(1)
    particle.x = 0
    particle.y = 0

    const index = this.particles.indexOf(particle)
    if (index !== -1) {
      this.particles.splice(index, 1)
    }

    if (this.particlePool.length < this.poolSize) {
      this.particlePool.push(particle)
    }
  }

  /**
   * Emit particles with GSAP animations
   * @param {Sprite} sprite - Source sprite
   * @param {string} type - Particle type
   * @param {number} intensity - Emission intensity
   * @param {Object} options - Additional options
   */
  emit(sprite: Sprite, type: string = "sparkle", intensity: number = 1, options: object = {}) {
    if (!sprite || !sprite.parent) {
      warn("visualEffectsEngine", "Cannot emit particles: invalid sprite")
      return
    }

    const config = PARTICLE_CONFIGS[type] || PARTICLE_CONFIGS.sparkle
    const count = Math.floor((config.count || 10) * intensity)
    const customColor = options.color || null
    const spread = options.spread || 1

    for (let i = 0; i < count; i++) {
      this._createParticle(sprite, config, intensity, customColor, spread)
    }

    debug("visualEffectsEngine", `Emitted ${count} ${type} particles`)
  }

  /**
   * Create individual particle with GSAP animation
   * @private
   * @param {Sprite} sprite - Source sprite
   * @param {Object} config - Particle configuration
   * @param {number} intensity - Intensity multiplier
   * @param {string} customColor - Custom color override
   * @param {number} spread - Position spread multiplier
   */
  _createParticle(sprite: Sprite, config: object, intensity: number, customColor: string, spread: number) {
    const particle = this._getParticle()
    if (!particle) return

    try {
      const startColor = customColor || config.color.start
      const endColor = customColor || config.color.end
      const startColorHex = interpolateColor(startColor, startColor, 0)

      const size = (config.size || 5) * config.scale.start
      particle.clear()
      particle.circle(0, 0, size)
      particle.fill({ color: startColorHex, alpha: 1 })

      particle.x = sprite.x + random(-20, 20) * spread
      particle.y = sprite.y + random(-20, 20) * spread
      particle.scale.set(config.scale.start)

      const angle = random(0, Math.PI * 2)
      const distance = random(50, 150) * intensity
      const targetX = particle.x + Math.cos(angle) * distance
      const targetY = particle.y + Math.sin(angle) * distance

      const timeline = gsap.timeline({
        onComplete: () => {
          this._recycleParticle(particle)
          this.activeAnimations.delete(timeline)
        }
      })

      this.activeAnimations.add(timeline)

      timeline
        .to(particle, {
          duration: config.life,
          x: targetX,
          y: targetY,
          ease: config.ease || "power2.out"
        }, 0)
        .to(particle.scale, {
          duration: config.life,
          x: config.scale.end,
          y: config.scale.end,
          ease: config.ease || "power2.out"
        }, 0)
        .to(particle, {
          duration: config.life,
          alpha: 0,
          ease: "power2.out"
        }, 0)
        .to(particle, {
          duration: config.life,
          pixi: { 
            tint: interpolateColor(startColor, endColor, 1) 
          },
          ease: "none"
        }, 0)

    } catch (e) {
      error("visualEffectsEngine", `Error creating particle: ${e.message}`)
      this._recycleParticle(particle)
    }
  }

  /**
   * Create explosion effect with enhanced visuals
   * @param {Sprite|Object} target - Target sprite or position
   * @param {Object} options - Explosion options
   */
  createExplosion(target: Sprite | object, options: object = {}) {
    const {
      color = "#ff6600",
      count = 20,
      maxRadius = 200,
      duration = 1.5,
      intensity = 1,
      colors = null
    } = options

    if (!target) {
      warn("visualEffectsEngine", "Cannot create explosion: invalid target")
      return
    }

    const x = target.x || 0
    const y = target.y || 0
    const colorPalette = colors || [color]

    for (let wave = 0; wave < 3; wave++) {
      setTimeout(() => {
        const waveCount = Math.floor(count / 3)
        const waveRadius = maxRadius * (wave + 1) / 3
        
        for (let i = 0; i < waveCount; i++) {
          const particle = this._getParticle()
          if (!particle) continue

          const particleColor = sample(colorPalette)
          const angle = (i / waveCount) * Math.PI * 2 + random(-0.5, 0.5)
          const distance = random(waveRadius * 0.5, waveRadius)
          const size = random(4, 8) * intensity

          particle.clear()
          particle.circle(0, 0, size)
          particle.fill({ color: interpolateColor(particleColor, particleColor, 0), alpha: 1 })

          particle.x = x
          particle.y = y
          particle.scale.set(0.1)

          const targetX = x + Math.cos(angle) * distance
          const targetY = y + Math.sin(angle) * distance

          const timeline = gsap.timeline({
            onComplete: () => {
              this._recycleParticle(particle)
              this.activeAnimations.delete(timeline)
            }
          })

          this.activeAnimations.add(timeline)

          timeline
            .to(particle.scale, {
              duration: 0.1,
              x: 1,
              y: 1,
              ease: "back.out(1.7)"
            })
            .to(particle, {
              duration: duration,
              x: targetX,
              y: targetY,
              ease: "power2.out"
            }, 0)
            .to(particle, {
              duration: duration,
              alpha: 0,
              ease: "power2.out"
            }, 0.2)
            .to(particle, {
              duration: duration,
              pixi: { 
                tint: interpolateColor(particleColor, "#000000", 1) 
              },
              ease: "none"
            }, 0)
        }
      }, wave * 100)
    }

    debug("visualEffectsEngine", `Created explosion with ${count} particles`)
  }

  /**
   * Pause all particle animations
   */
  pause() {
    this.isPaused = true
    this.activeAnimations.forEach(timeline => timeline.pause())
  }

  /**
   * Resume all particle animations
   */
  resume() {
    this.isPaused = false
    this.activeAnimations.forEach(timeline => timeline.resume())
  }

  /**
   * Clear all particles and reset system
   */
  reset() {
    debug("visualEffectsEngine", "Resetting particle system")

    this.activeAnimations.forEach(timeline => timeline.kill())
    this.activeAnimations.clear()

    while (this.particles.length > 0) {
      this._recycleParticle(this.particles[0])
    }

    this.isPaused = false
    debug("visualEffectsEngine", "Particle system reset complete")
  }

  /**
   * Clean up all resources
   */
  cleanup() {
    debug("visualEffectsEngine", "Cleaning up particle system")

    this.activeAnimations.forEach(timeline => timeline.kill())
    this.activeAnimations.clear();

    [...this.particles, ...this.particlePool].forEach(particle => {
      if (particle.parent) {
        particle.parent.removeChild(particle)
      }
      particle.destroy({ children: true })
    })

    this.particles = []
    this.particlePool = []

    if (this.container.parent) {
      this.container.parent.removeChild(this.container)
    }

    this.container.destroy({ children: true })
    this.container = null

    debug("visualEffectsEngine", "Particle system cleanup complete")
  }
}

// ========================================================================
// Enhanced Effect Manager
// ========================================================================

/**
 * Centralized effect management system
 */
export class EffectManager {
  particleSystems: Map<any, any>
  distortionEffects: Map<any, any>
  globalTimeline: gsap.core.Timeline
  isPaused: boolean
  constructor() {
    this.particleSystems = new Map()
    this.distortionEffects = new Map()
    this.globalTimeline = gsap.timeline()
    this.isPaused = false
  }

  /**
   * Create a new particle system
   * @param {string} name - System name
   * @param {Container} parent - Parent container
   * @param {Object} options - Configuration options
   * @returns {ParticleSystem} Created particle system
   */
  createParticleSystem(name: string, parent: Container, options: object = {}): ParticleSystem {
    if (this.particleSystems.has(name)) {
      warn("visualEffectsEngine", `Particle system '${name}' already exists`)
      return this.particleSystems.get(name)
    }

    const system = new ParticleSystem(parent, options)
    this.particleSystems.set(name, system)
    return system
  }

  /**
   * Create a new distortion effect
   * @param {string} name - Effect name
   * @param {Sprite} sprite - Target sprite
   * @param {string} type - Effect type
   * @param {number} intensity - Effect intensity
   * @param {Object} options - Additional options
   * @returns {DistortionSystem} Created distortion effect
   */
  createDistortionEffect(name: string, sprite: Sprite, type: string, intensity: number, options: object = {}): DistortionSystem {
    if (this.distortionEffects.has(name)) {
      warn("visualEffectsEngine", `Distortion effect '${name}' already exists`)
      return this.distortionEffects.get(name)
    }

    const effect = new DistortionSystem(sprite, type, intensity, options)
    this.distortionEffects.set(name, effect)
    return effect
  }

  /**
   * Get particle system by name
   * @param {string} name - System name
   * @returns {ParticleSystem|null} Particle system or null
   */
  getParticleSystem(name: string): ParticleSystem | null {
    return this.particleSystems.get(name) || null
  }

  /**
   * Get distortion effect by name
   * @param {string} name - Effect name
   * @returns {DistortionSystem|null} Distortion effect or null
   */
  getDistortionEffect(name: string): DistortionSystem | null {
    return this.distortionEffects.get(name) || null
  }

  /**
   * Pause all effects
   */
  pauseAll() {
    this.isPaused = true
    this.globalTimeline.pause()
    this.particleSystems.forEach(system => system.pause())
    this.distortionEffects.forEach(effect => effect.pause())
  }

  /**
   * Resume all effects
   */
  resumeAll() {
    this.isPaused = false
    this.globalTimeline.resume()
    this.particleSystems.forEach(system => system.resume())
    this.distortionEffects.forEach(effect => effect.resume())
  }

  /**
   * Clean up all effects
   */
  cleanup() {
    debug("visualEffectsEngine", "Cleaning up all effects")

    this.globalTimeline.kill()
    
    this.particleSystems.forEach(system => system.cleanup())
    this.particleSystems.clear()
    
    this.distortionEffects.forEach(effect => effect.cleanup())
    this.distortionEffects.clear()

    debug("visualEffectsEngine", "Effect manager cleanup complete")
  }
}

// ========================================================================
// Visual Effects Application
// ========================================================================

/**
 * Apply visual effects to a sprite
 * @param {Sprite} sprite - Target sprite
 * @param {Object} appearance - Appearance configuration
 * @param {EffectManager} effectManager - Effect manager instance
 */
export function applyVisualEffects(sprite: Sprite, appearance: object, effectManager: EffectManager) {
  if (!Application || !sprite || !appearance) {
    warn("visualEffectsEngine", "Cannot apply visual effects: invalid input")
    return
  }

  const filters = []

  // Handle tint
  const { color } = appearance
  if (color && color.tint && color.tint !== "0" && color.tintIntensity > 0) {
    try {
      const tintColor = Number.parseInt(color.tint.replace("#", ""), 16)
      sprite.tint = tintColor
      sprite.tintIntensity = color.tintIntensity
      debug("visualEffectsEngine", `Applied tint ${color.tint} with intensity ${color.tintIntensity}`)
    } catch (e) {
      error("visualEffectsEngine", `Failed to apply tint: ${e.message}`)
    }
  }

  // Apply glow effect
  if (appearance?.glowIntensity && Number.parseFloat(appearance.glowIntensity) > 0) {
    try {
      const glowColor = appearance.glowColor || "#FFFFFF"
      const glowIntensity = Number.parseFloat(appearance.glowIntensity)
      const colorNum = Number.parseInt(glowColor.replace("#", ""), 16)
      const glowFilter = new GlowFilter({
        distance: 10,
        outerStrength: glowIntensity * 2,
        innerStrength: 0,
        color: colorNum,
        quality: 0.1
      })
      filters.push(glowFilter)
      debug("visualEffectsEngine", `Applied GlowFilter with intensity ${glowIntensity}, color ${glowColor}`)
    } catch (e) {
      error("visualEffectsEngine", `Failed to apply GlowFilter: ${e.message}`)
    }
  }

  // Apply shadow effect
  if (appearance?.shadowSize && Number.parseFloat(appearance.shadowSize) > 0) {
    try {
      const shadowColor = appearance.shadowColor || "#000000"
      const shadowSize = Number.parseFloat(appearance.shadowSize)
      const colorNum = Number.parseInt(shadowColor.replace("#", ""), 16)
      const shadowFilter = new DropShadowFilter({
        distance: shadowSize,
        angle: Math.PI / 4,
        alpha: 0.5,
        color: colorNum
      })
      filters.push(shadowFilter)
      debug("visualEffectsEngine", `Applied DropShadowFilter with size ${shadowSize}, color ${shadowColor}`)
    } catch (e) {
      error("visualEffectsEngine", `Failed to apply DropShadowFilter: ${e.message}`)
    }
  }

  // Apply blend mode
  const blendMode = appearance?.blendMode || "normal"
  try {
    switch (blendMode.toLowerCase()) {
      case "add":
        sprite.blendMode = "add";
        break;
      case "multiply":
        sprite.blendMode = "multiply";
        break;
      case "screen":
        sprite.blendMode = "screen";
        break;
      default:
        sprite.blendMode = "normal";
    }
    debug("visualEffectsEngine", `Applied blend mode ${blendMode}`)
  } catch (e) {
    error("visualEffectsEngine", `Failed to apply blend mode: ${e.message}`)
  }

  // Apply distortion effect using DistortionSystem
  const distortionType = appearance?.distortionType || "0"
  const distortionIntensity = Number.parseFloat(appearance?.distortionIntensity) || 0
  if (distortionType !== "0" && distortionIntensity > 0 && effectManager) {
    try {
      const effectName = `distortion_${sprite.id || Math.random().toString(36).substr(2, 9)}`
      const distortionEffect = effectManager.createDistortionEffect(
        effectName,
        sprite,
        distortionType,
        distortionIntensity
      )
      sprite.distortionEffect = distortionEffect
      debug("visualEffectsEngine", `Applied ${distortionType} distortion with intensity ${distortionIntensity}`)
    } catch (e) {
      error("visualEffectsEngine", `Failed to apply distortion effect: ${e.message}`)
    }
  }

  // Apply filters to sprite
  sprite.filters = filters.length > 0 ? filters : null
}

/**
 * Update visual effects for all sprites
 * @param {Sprite[]} sprites - Array of sprites
 * @param {number} deltaTime - Delta time in milliseconds
 */
export function updateVisualEffects(sprites: Sprite[], deltaTime: number) {
  if (!Application) return

  sprites.forEach(sprite => {
    // Update distortion effects via DistortionSystem
    if (sprite.distortionEffect) {
      sprite.distortionEffect.updateCenter()
    }
  })

  // GSAP handles animation timing internally, no need for manual accumulatedTime
  debug("visualEffectsEngine", "Updated visual effects for sprites")
}

// ========================================================================
// Exports
// ========================================================================

export {
  PARTICLE_CONFIGS,
  DISTORTION_CONFIGS,
  interpolateColor,
  getRandomColor
}