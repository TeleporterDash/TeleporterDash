// Modules/cameraManager.js
import { warn, debug, verbose, setLogLevel } from "./logManager"
import { gsap } from "gsap"
import _ from "lodash"

setLogLevel("debug")

/**
 * Enhanced CameraManager
 * Handles camera movement, tracking, and effects for the game
 */
export default class CameraManager {
  constructor(container, levelWidth, levelHeight, viewportWidth, viewportHeight) {
    this.container = container
    this.levelWidth = levelWidth
    this.levelHeight = levelHeight
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight

    // Current camera position
    this.x = 0
    this.y = 0
    this.targetX = 0
    this.targetY = 0

    // Camera smoothing configuration
    this.smoothing = 0.1
    this.adaptiveSmoothing = true // Enable adaptive smoothing based on movement speed
    this.maxSmoothingSpeed = 500 // Pixels per second threshold for max smoothing
    this.minSmoothingFactor = 0.02
    this.maxSmoothingFactor = 0.3

    // Dead zone configuration
    this.deadZoneThreshold = 0.05
    this.adaptiveDeadZone = true
    this.baseDeadZone = 0.05
    this.maxDeadZone = 0.15

    // Predictive tracking
    this.predictiveTracking = true
    this.predictionStrength = 0.3
    this.velocityHistory = []
    this.maxVelocityHistory = 5

    // Look-ahead configuration
    this.lookAhead = true
    this.lookAheadDistance = 100
    this.lookAheadSmoothing = 0.1

    // Bounds and constraints
    this.bounds = {
      left: 0,
      right: levelWidth - viewportWidth,
      top: 0,
      bottom: levelHeight - viewportHeight,
    }

    // Floor visibility
    this.keepFloorVisible = true
    this.floorOffset = 32

    // Camera zones for different behaviors
    this.zones = new Map()
    this.currentZone = null

    // Performance optimization
    this.updateThrottle = 16 // ~60fps
    this.lastUpdateTime = 0
    this.isDirty = false

    // Enhanced effects system
    this.effects = {
      zoom: { tween: null, level: 1.0, min: 0.1, max: 5.0 },
      shake: { tween: null, intensity: 0, originalPos: null },
      tilt: { tween: null, angle: 0 },
      pan: { tween: null, offset: { x: 0, y: 0 } },
      drift: { enabled: false, speed: 0.5, amplitude: 10 },
      focus: { target: null, strength: 0.8, radius: 200 }
    }

    // Event system
    this.events = new Map()

    // Initialize
    this.init()
  }

  /**
   * Initialize camera system
   */
  init() {
    // Set up viewport resize handling
    this.setupViewportHandling()
    
    // Initialize performance monitoring
    this.setupPerformanceMonitoring()
    
    debug("CameraManager", "Camera system initialized")
  }

  /**
   * Set up viewport resize handling
   */
  setupViewportHandling() {
    // Debounced resize handler
    this.handleResize = _.debounce(() => {
      this.updateDimensions(this.levelWidth, this.levelHeight, this.viewportWidth, this.viewportHeight)
    }, 100)
  }

  /**
   * Set up performance monitoring
   */
  setupPerformanceMonitoring() {
    this.performanceStats = {
      frameCount: 0,
      totalTime: 0,
      avgUpdateTime: 0,
      maxUpdateTime: 0
    }
  }

  /**
   * Add camera zone with specific behavior
   * @param {string} name - Zone name
   * @param {Object} bounds - Zone bounds {x, y, width, height}
   * @param {Object} config - Zone configuration
   */
  addZone(name, bounds, config = {}) {
    this.zones.set(name, {
      bounds,
      smoothing: config.smoothing || this.smoothing,
      deadZone: config.deadZone || this.deadZoneThreshold,
      keepFloorVisible: config.keepFloorVisible !== undefined ? config.keepFloorVisible : this.keepFloorVisible,
      lookAhead: config.lookAhead !== undefined ? config.lookAhead : this.lookAhead,
      effects: config.effects || {}
    })
  }

  /**
   * Check if point is in zone
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} zone - Zone configuration
   */
  isInZone(x, y, zone) {
    const { bounds } = zone
    return x >= bounds.x && x <= bounds.x + bounds.width &&
           y >= bounds.y && y <= bounds.y + bounds.height
  }

  /**
   * Update current zone based on target position
   * @param {number} targetX - Target X position
   * @param {number} targetY - Target Y position
   */
  updateCurrentZone(targetX, targetY) {
    let newZone = null
    
    for (const [name, zone] of this.zones) {
      if (this.isInZone(targetX, targetY, zone)) {
        newZone = { name, ...zone }
        break
      }
    }

    if (newZone !== this.currentZone) {
      this.currentZone = newZone
      this.onZoneChange(newZone)
    }
  }

  /**
   * Handle zone change
   * @param {Object} newZone - New zone configuration
   */
  onZoneChange(newZone) {
    if (newZone) {
      debug("CameraManager", `Entered zone: ${newZone.name}`)
      this.smoothing = newZone.smoothing
      this.deadZoneThreshold = newZone.deadZone
      this.keepFloorVisible = newZone.keepFloorVisible
      this.lookAhead = newZone.lookAhead
      
      // Apply zone effects
      if (newZone.effects) {
        Object.keys(newZone.effects).forEach(effect => {
          this.applyEffect(effect, newZone.effects[effect])
        })
      }
    } else {
      debug("CameraManager", "Exited all zones")
      this.resetToDefaults()
    }
  }

  /**
   * Reset camera to default settings
   */
  resetToDefaults() {
    this.smoothing = 0.1
    this.deadZoneThreshold = 0.05
    this.keepFloorVisible = true
    this.lookAhead = true
  }

  /**
   * Enhanced follow with predictive tracking and look-ahead
   * @param {Object} target - Target to follow
   * @param {number} offsetX - X offset from center
   * @param {number} offsetY - Y offset from center
   */
  follow(target, offsetX = 0, offsetY = 0) {
    if (!target || typeof target.x !== "number" || typeof target.y !== "number") {
      warn("cameraManager", "Invalid target for camera follow:", target)
      return
    }

    // Update velocity history for predictive tracking
    this.updateVelocityHistory(target)

    // Check for zone changes
    this.updateCurrentZone(target.x, target.y)

    // Calculate base position with look-ahead
    let baseX = target.x
    let baseY = target.y

    // Apply look-ahead based on movement direction
    if (this.lookAhead && this.velocityHistory.length > 0) {
      const velocity = this.getAverageVelocity()
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
      
      if (speed > 50) { // Only apply look-ahead if moving fast enough
        const lookAheadFactor = Math.min(speed / 300, 1.0) // Scale based on speed
        baseX += velocity.x * this.lookAheadDistance * lookAheadFactor * 0.016 // Assuming 60fps
        baseY += velocity.y * this.lookAheadDistance * lookAheadFactor * 0.016
      }
    }

    // Horizontal offset for showing more ahead
    const horizOffset = -this.viewportWidth * 0.2

    // Calculate target position
    this.targetX = baseX - this.viewportWidth / 2 + horizOffset + offsetX
    this.targetY = baseY - this.viewportHeight / 2 + offsetY

    // Apply predictive tracking
    if (this.predictiveTracking && this.velocityHistory.length > 1) {
      const prediction = this.getPredictedPosition(target)
      this.targetX = _.clamp(
        this.targetX + (prediction.x - target.x) * this.predictionStrength,
        this.bounds.left,
        this.bounds.right
      )
      this.targetY = _.clamp(
        this.targetY + (prediction.y - target.y) * this.predictionStrength,
        this.bounds.top,
        this.bounds.bottom
      )
    }

    // Ensure floor visibility
    if (this.keepFloorVisible) {
      const floorY = this.levelHeight - this.floorOffset
      const minCameraY = floorY - this.viewportHeight
      this.targetY = Math.max(this.targetY, minCameraY)
    }

    this.isDirty = true
  }

  /**
   * Update velocity history for predictive tracking
   * @param {Object} target - Target object
   */
  updateVelocityHistory(target) {
    if (this.velocityHistory.length === 0) {
      this.velocityHistory.push({ x: target.x, y: target.y, time: Date.now() })
      return
    }

    const lastPos = this.velocityHistory[this.velocityHistory.length - 1]
    const currentTime = Date.now()
    const deltaTime = (currentTime - lastPos.time) / 1000 // Convert to seconds

    if (deltaTime > 0) {
      const velocity = {
        x: (target.x - lastPos.x) / deltaTime,
        y: (target.y - lastPos.y) / deltaTime,
        time: currentTime
      }

      this.velocityHistory.push(velocity)
      
      // Keep history size manageable
      if (this.velocityHistory.length > this.maxVelocityHistory) {
        this.velocityHistory.shift()
      }
    }
  }

  /**
   * Get average velocity from history
   * @returns {Object} Average velocity
   */
  getAverageVelocity() {
    if (this.velocityHistory.length < 2) return { x: 0, y: 0 }

    const recent = this.velocityHistory.slice(-3) // Use last 3 samples
    const avgX = recent.reduce((sum, v) => sum + v.x, 0) / recent.length
    const avgY = recent.reduce((sum, v) => sum + v.y, 0) / recent.length

    return { x: avgX, y: avgY }
  }

  /**
   * Get predicted position based on velocity
   * @param {Object} target - Current target
   * @returns {Object} Predicted position
   */
  getPredictedPosition(target) {
    const velocity = this.getAverageVelocity()
    const predictionTime = 0.1 // Predict 100ms ahead

    return {
      x: target.x + velocity.x * predictionTime,
      y: target.y + velocity.y * predictionTime
    }
  }

  /**
   * Enhanced update with adaptive smoothing and performance optimization
   * @param {number} deltaTime - Time since last update in milliseconds
   */
  update(deltaTime = 16) {
    const currentTime = Date.now()
    
    // Throttle updates for performance
    if (currentTime - this.lastUpdateTime < this.updateThrottle && !this.isDirty) {
      return
    }

    const startTime = performance.now()
    this.lastUpdateTime = currentTime

    // Calculate adaptive smoothing based on movement speed
    const targetSpeed = Math.sqrt(
      Math.pow(this.targetX - this.x, 2) + Math.pow(this.targetY - this.y, 2)
    )

    let smoothingFactor = this.smoothing
    if (this.adaptiveSmoothing) {
      const speedRatio = Math.min(targetSpeed / this.maxSmoothingSpeed, 1.0)
      smoothingFactor = _.clamp(
        this.minSmoothingFactor + (this.maxSmoothingFactor - this.minSmoothingFactor) * speedRatio,
        this.minSmoothingFactor,
        this.maxSmoothingFactor
      )
    }

    // Calculate adaptive dead zone
    let deadZoneThreshold = this.deadZoneThreshold
    if (this.adaptiveDeadZone) {
      const velocity = this.getAverageVelocity()
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
      const speedRatio = Math.min(speed / 200, 1.0)
      deadZoneThreshold = this.baseDeadZone + (this.maxDeadZone - this.baseDeadZone) * speedRatio
    }

    // Calculate dead zone in pixels
    const deadZoneX = this.viewportWidth * deadZoneThreshold
    const deadZoneY = this.viewportHeight * deadZoneThreshold

    // Calculate movement delta
    const dx = this.targetX - this.x
    const dy = this.targetY - this.y

    let nextX = this.x
    let nextY = this.y

    // Apply smoothing with dead zone
    if (Math.abs(dx) > deadZoneX) {
      nextX += dx * smoothingFactor
    }

    if (Math.abs(dy) > deadZoneY) {
      nextY += dy * smoothingFactor
    }

    // Apply drift effect if enabled
    if (this.effects.drift.enabled) {
      const time = currentTime / 1000
      nextX += Math.sin(time * this.effects.drift.speed) * this.effects.drift.amplitude
      nextY += Math.cos(time * this.effects.drift.speed * 0.7) * this.effects.drift.amplitude * 0.5
    }

    // Clamp position within bounds
    this.x = _.clamp(nextX, this.bounds.left, this.bounds.right)
    this.y = _.clamp(nextY, this.bounds.top, this.bounds.bottom)

    // Apply position to container
    this.container.x = -this.x
    this.container.y = -this.y

    // Update performance stats
    const updateTime = performance.now() - startTime
    this.updatePerformanceStats(updateTime)

    this.isDirty = false

    verbose("cameraManager", `Update: X=${this.x.toFixed(2)}, Y=${this.y.toFixed(2)}, Smoothing=${smoothingFactor.toFixed(3)}`)
  }

  /**
   * Update performance statistics
   * @param {number} updateTime - Time taken for update
   */
  updatePerformanceStats(updateTime) {
    this.performanceStats.frameCount++
    this.performanceStats.totalTime += updateTime
    this.performanceStats.avgUpdateTime = this.performanceStats.totalTime / this.performanceStats.frameCount
    this.performanceStats.maxUpdateTime = Math.max(this.performanceStats.maxUpdateTime, updateTime)
  }

  /**
   * Enhanced zoom with easing options
   * @param {number} level - Zoom level
   * @param {number} duration - Animation duration
   * @param {string} ease - Easing function
   * @param {Function} onComplete - Completion callback
   */
  zoomTo(level, duration = 0.5, ease = "power2.inOut", onComplete = null) {
    if (this.effects.zoom.tween) this.effects.zoom.tween.kill()

    const targetLevel = _.clamp(level, this.effects.zoom.min, this.effects.zoom.max)
    
    if (duration <= 0) {
      this.container.scale.set(targetLevel)
      this.effects.zoom.level = targetLevel
      if (onComplete) onComplete()
      return
    }

    this.effects.zoom.tween = gsap.to(this.container.scale, {
      x: targetLevel,
      y: targetLevel,
      duration: duration,
      ease: ease,
      onUpdate: () => {
        this.effects.zoom.level = this.container.scale.x
        // Maintain center pivot
        this.container.pivot.set(this.viewportWidth / 2, this.viewportHeight / 2)
        this.container.position.set(this.viewportWidth / 2, this.viewportHeight / 2)
      },
      onComplete: () => {
        if (onComplete) onComplete()
      }
    })
  }

  /**
   * Enhanced shake with different patterns
   * @param {number} intensity - Shake intensity
   * @param {number} duration - Shake duration
   * @param {string} pattern - Shake pattern ('random', 'horizontal', 'vertical', 'circular')
   */
  shake(intensity = 5, duration = 0.5, pattern = 'random') {
    if (this.effects.shake.tween) this.effects.shake.tween.kill()

    const originalX = this.container.x
    const originalY = this.container.y
    this.effects.shake.originalPos = { x: originalX, y: originalY }
    this.effects.shake.intensity = intensity

    const shakePatterns = {
      random: () => ({
        x: (Math.random() - 0.5) * intensity * 2,
        y: (Math.random() - 0.5) * intensity * 2
      }),
      horizontal: () => ({
        x: (Math.random() - 0.5) * intensity * 2,
        y: 0
      }),
      vertical: () => ({
        x: 0,
        y: (Math.random() - 0.5) * intensity * 2
      }),
      circular: (time) => ({
        x: Math.cos(time * 30) * intensity,
        y: Math.sin(time * 30) * intensity
      })
    }

    const getOffset = shakePatterns[pattern] || shakePatterns.random
    let startTime = Date.now()

    this.effects.shake.tween = gsap.to({}, {
      duration: duration,
      ease: "power2.out",
      onUpdate: () => {
        const elapsed = (Date.now() - startTime) / 1000
        const decay = 1 - (elapsed / duration)
        const offset = getOffset(elapsed)
        
        this.container.x = originalX + offset.x * decay
        this.container.y = originalY + offset.y * decay
      },
      onComplete: () => {
        this.container.x = originalX
        this.container.y = originalY
        this.effects.shake.intensity = 0
        this.effects.shake.originalPos = null
      }
    })
  }

  /**
   * Smooth camera transition to position
   * @param {number} x - Target X position
   * @param {number} y - Target Y position
   * @param {number} duration - Transition duration
   * @param {string} ease - Easing function
   * @param {Function} onComplete - Completion callback
   */
  transitionTo(x, y, duration = 1.0, ease = "power2.inOut", onComplete = null) {
    return gsap.to(this, {
      targetX: x,
      targetY: y,
      duration: duration,
      ease: ease,
      onUpdate: () => {
        this.isDirty = true
      },
      onComplete: () => {
        if (onComplete) onComplete()
      }
    })
  }

  /**
   * Focus on a specific target with smooth transition
   * @param {Object} target - Target to focus on
   * @param {number} duration - Focus duration
   * @param {number} zoom - Optional zoom level
   */
  focusOn(target, duration = 1.0, zoom = null) {
    if (!target) return

    const targetX = target.x - this.viewportWidth / 2
    const targetY = target.y - this.viewportHeight / 2

    // Store current focus
    this.effects.focus.target = target

    // Transition to target
    const transition = this.transitionTo(targetX, targetY, duration)

    // Apply zoom if specified
    if (zoom !== null) {
      this.zoomTo(zoom, duration)
    }

    return transition
  }

  /**
   * Apply drift effect
   * @param {boolean} enabled - Enable drift
   * @param {number} speed - Drift speed
   * @param {number} amplitude - Drift amplitude
   */
  setDrift(enabled, speed = 0.5, amplitude = 10) {
    this.effects.drift.enabled = enabled
    this.effects.drift.speed = speed
    this.effects.drift.amplitude = amplitude
  }

  /**
   * Get current camera state
   * @returns {Object} Camera state
   */
  getState() {
    return {
      x: this.x,
      y: this.y,
      targetX: this.targetX,
      targetY: this.targetY,
      zoom: this.effects.zoom.level,
      bounds: { ...this.bounds },
      currentZone: this.currentZone?.name || null,
      performance: { ...this.performanceStats }
    }
  }

  /**
   * Set camera bounds with validation
   * @param {number} left - Left bound
   * @param {number} right - Right bound
   * @param {number} top - Top bound
   * @param {number} bottom - Bottom bound
   */
  setBounds(left, right, top, bottom) {
    this.bounds = {
      left: Math.max(0, left),
      right: Math.min(this.levelWidth - this.viewportWidth, right),
      top: Math.max(0, top),
      bottom: Math.min(this.levelHeight - this.viewportHeight, bottom)
    }
  }

  /**
   * Enhanced reset with smooth transition option
   * @param {Object} player - Player object
   * @param {boolean} smooth - Use smooth transition
   * @param {number} duration - Transition duration if smooth
   */
  reset(player, smooth = false, duration = 1.0) {
    debug("CameraManager", "Resetting camera position...")

    // Reset effects
    this.resetEffects()

    // Calculate reset position
    const resetX = player.initialX - this.viewportWidth / 2
    const resetY = player.initialY - this.viewportHeight / 2

    if (smooth) {
      this.transitionTo(resetX, resetY, duration)
    } else {
      this.setPosition(resetX, resetY)
    }

    // Clear velocity history
    this.velocityHistory = []
    this.currentZone = null
    this.isDirty = false

    debug("CameraManager", `Camera reset to: (${resetX.toFixed(2)}, ${resetY.toFixed(2)})`)
  }

  /**
   * Enhanced setPosition with bounds checking
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  setPosition(x, y) {
    this.targetX = x
    this.targetY = y
    this.x = _.clamp(x, this.bounds.left, this.bounds.right)
    this.y = _.clamp(y, this.bounds.top, this.bounds.bottom)

    // Apply position to container
    this.container.x = -this.x
    this.container.y = -this.y

    this.isDirty = false
  }

  /**
   * Reset all camera effects
   */
  resetEffects() {
    Object.values(this.effects).forEach(effect => {
      if (effect.tween) effect.tween.kill()
    })

    // Reset container transforms
    this.container.scale.set(1)
    this.container.rotation = 0
    this.container.skew.set(0)
    this.container.pivot.set(0)
    this.container.filters = null

    // Reset effect states
    this.effects.zoom.level = 1.0
    this.effects.shake.intensity = 0
    this.effects.shake.originalPos = null
    this.effects.tilt.angle = 0
    this.effects.drift.enabled = false
    this.effects.focus.target = null
  }

  /**
   * Update camera dimensions with smooth transition
   * @param {number} levelWidth - Level width
   * @param {number} levelHeight - Level height
   * @param {number} viewportWidth - Viewport width
   * @param {number} viewportHeight - Viewport height
   */
  updateDimensions(levelWidth, levelHeight, viewportWidth, viewportHeight) {
    this.levelWidth = levelWidth
    this.levelHeight = levelHeight
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight

    // Update bounds
    this.setBounds(0, levelWidth - viewportWidth, 0, levelHeight - viewportHeight)

    // Revalidate current position
    this.setPosition(this.x, this.y)
  }

  /**
   * Get performance statistics
   * @returns {Object} Performance stats
   */
  getPerformanceStats() {
    return { ...this.performanceStats }
  }

  /**
   * Clean up camera manager
   */
  dispose() {
    this.resetEffects()
    this.zones.clear()
    this.events.clear()
    this.velocityHistory = []
    debug("CameraManager", "Camera manager disposed")
  }
}