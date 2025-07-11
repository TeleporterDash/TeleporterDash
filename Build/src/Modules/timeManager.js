// Modules/timeManager.js
import { gsap } from 'gsap'
import _ from 'lodash'
import { StorageManager } from './storageManager.js'

class TimeManager {
  constructor() {
    this.lastTime = 0
    this.deltaTime = 0
    this.timeScale = 1.0
    this.paused = false
    this.accumulator = 0
    this.fixedTimeStep = 1 / 60 // 60 FPS fixed timestep
    this.scaledDelta = 0
    
    // Enhanced features
    this.frameCount = 0
    this.totalTime = 0
    this.averageFPS = 0
    this.fpsHistory = []
    this.maxFPSHistory = 60
    
    // Time effects and tweens
    this.timeEffects = new Map()
    this.tweenTimeline = gsap.timeline({ paused: true })
    
    // Performance monitoring
    this.performanceMetrics = {
      frameTime: 0,
      worstFrame: 0,
      bestFrame: Infinity,
      lagSpikes: 0
    }
    
    // Event system for time-based events
    this.timeEvents = []
    this.scheduledEvents = new Map()
    
    // Settings persistence
    this.settings = {
      targetFPS: 60,
      adaptiveSync: true,
      vsyncMode: 'auto',
      performanceMode: 'balanced'
    }
    
    this.init()
  }

  async init() {
    // Load saved settings
    try {
      const savedSettings = await StorageManager.getFromStore('game', 'timeManagerSettings')
      if (savedSettings) {
        this.settings = { ...this.settings, ...savedSettings }
        this.fixedTimeStep = 1 / this.settings.targetFPS
      }
    } catch (error) {
      console.warn('Could not load TimeManager settings:', error)
    }
  }

  // Enhanced update method with performance monitoring
  update(currentTime) {
    if (!currentTime) currentTime = performance.now()
    
    // Calculate raw delta time in seconds
    const rawDelta = (currentTime - (this.lastTime || currentTime)) / 1000
    this.lastTime = currentTime
    
    // Apply time scale and cap max delta to prevent spiral of death
    this.deltaTime = Math.min(rawDelta * this.timeScale, 0.25)
    this.scaledDelta = this.deltaTime * this.timeScale
    
    // Update performance metrics
    this.updatePerformanceMetrics(rawDelta)
    
    // Update fixed timestep accumulator
    if (!this.paused) {
      this.accumulator += this.deltaTime
      this.totalTime += this.deltaTime
    }
    
    // Update frame count and FPS
    this.frameCount++
    this.updateFPS(rawDelta)
    
    // Process scheduled events
    this.processScheduledEvents()
    
    // Update GSAP timeline for time effects
    this.tweenTimeline.progress(this.totalTime % 1)
    
    return this.deltaTime
  }

  // FPS calculation with rolling average
  updateFPS(deltaTime) {
    if (deltaTime > 0) {
      const currentFPS = 1 / deltaTime
      this.fpsHistory.push(currentFPS)
      
      if (this.fpsHistory.length > this.maxFPSHistory) {
        this.fpsHistory.shift()
      }
      
      this.averageFPS = _.mean(this.fpsHistory)
    }
  }

  // Performance monitoring
  updatePerformanceMetrics(deltaTime) {
    this.performanceMetrics.frameTime = deltaTime * 1000 // Convert to ms
    
    if (this.performanceMetrics.frameTime > this.performanceMetrics.worstFrame) {
      this.performanceMetrics.worstFrame = this.performanceMetrics.frameTime
    }
    
    if (this.performanceMetrics.frameTime < this.performanceMetrics.bestFrame) {
      this.performanceMetrics.bestFrame = this.performanceMetrics.frameTime
    }
    
    // Detect lag spikes (frames taking more than 2x target time)
    const targetFrameTime = 1000 / this.settings.targetFPS
    if (this.performanceMetrics.frameTime > targetFrameTime * 2) {
      this.performanceMetrics.lagSpikes++
    }
  }

  // Enhanced fixed update with interpolation support
  runFixedUpdate(callback) {
    if (this.accumulator >= this.fixedTimeStep) {
      callback(this.fixedTimeStep)
      this.accumulator -= this.fixedTimeStep
      return true
    }
    return false
  }

  // Time scaling with smooth transitions using GSAP
  setTimeScale(scale, duration = 0) {
    scale = Math.max(0, scale)
    
    if (duration > 0) {
      gsap.to(this, {
        timeScale: scale,
        duration: duration,
        ease: "power2.inOut"
      })
    } else {
      this.timeScale = scale
    }
  }

  // Enhanced pause/unpause with state management
  pause() {
    this.paused = true
    this.tweenTimeline.pause()
    this.emit('paused')
  }

  resume() {
    this.paused = false
    this.tweenTimeline.resume()
    this.emit('resumed')
  }

  // Time effects using GSAP
  addTimeEffect(name, effect) {
    this.timeEffects.set(name, effect)
    return this
  }

  removeTimeEffect(name) {
    this.timeEffects.delete(name)
    return this
  }

  // Smooth time scale effects
  slowMotion(factor = 0.5, duration = 0.5) {
    this.setTimeScale(factor, duration)
    return this
  }

  speedUp(factor = 2.0, duration = 0.5) {
    this.setTimeScale(factor, duration)
    return this
  }

  resetTimeScale(duration = 0.5) {
    this.setTimeScale(1.0, duration)
    return this
  }

  // Time freeze effect
  freeze(duration = 1.0) {
    const originalScale = this.timeScale
    this.setTimeScale(0, 0.1)
    
    setTimeout(() => {
      this.setTimeScale(originalScale, 0.1)
    }, duration * 1000)
    
    return this
  }

  // Event scheduling system
  scheduleEvent(callback, delay, repeat = false) {
    const eventId = _.uniqueId('timeEvent_')
    const triggerTime = this.totalTime + delay
    
    this.scheduledEvents.set(eventId, {
      callback,
      triggerTime,
      repeat,
      delay: repeat ? delay : null
    })
    
    return eventId
  }

  cancelEvent(eventId) {
    this.scheduledEvents.delete(eventId)
  }

  // Process scheduled events
  processScheduledEvents() {
    for (const [eventId, event] of this.scheduledEvents) {
      if (this.totalTime >= event.triggerTime) {
        event.callback()
        
        if (event.repeat && event.delay) {
          // Reschedule for next occurrence
          event.triggerTime = this.totalTime + event.delay
        } else {
          // Remove one-time event
          this.scheduledEvents.delete(eventId)
        }
      }
    }
  }

  // Settings management
  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings }
    
    // Apply settings
    if (newSettings.targetFPS) {
      this.fixedTimeStep = 1 / newSettings.targetFPS
    }
    
    // Save to storage
    try {
      await StorageManager.saveToStore('game', 'timeManagerSettings', this.settings)
    } catch (error) {
      console.warn('Could not save TimeManager settings:', error)
    }
  }

  // Getters for various time measurements
  get time() {
    return this.totalTime
  }

  get frameTime() {
    return this.performanceMetrics.frameTime
  }

  get fps() {
    return this.averageFPS
  }

  get interpolationAlpha() {
    return this.accumulator / this.fixedTimeStep
  }

  get isRunningSmooth() {
    return this.averageFPS > this.settings.targetFPS * 0.9
  }

  // Performance analysis
  getPerformanceReport() {
    return {
      averageFPS: Math.round(this.averageFPS),
      frameTime: Math.round(this.performanceMetrics.frameTime * 100) / 100,
      worstFrame: Math.round(this.performanceMetrics.worstFrame * 100) / 100,
      bestFrame: Math.round(this.performanceMetrics.bestFrame * 100) / 100,
      lagSpikes: this.performanceMetrics.lagSpikes,
      totalFrames: this.frameCount,
      uptime: Math.round(this.totalTime * 100) / 100
    }
  }

  // Reset performance metrics
  resetPerformanceMetrics() {
    this.performanceMetrics = {
      frameTime: 0,
      worstFrame: 0,
      bestFrame: Infinity,
      lagSpikes: 0
    }
    this.fpsHistory = []
    this.frameCount = 0
  }

  // Simple event system
  emit(eventName, data) {
    // Could be enhanced with a proper event system
    if (this.onTimeEvent) {
      this.onTimeEvent(eventName, data)
    }
  }

  // Debug utilities
  debug() {
    console.table(this.getPerformanceReport())
    console.log('Time Effects:', Array.from(this.timeEffects.keys()))
    console.log('Scheduled Events:', this.scheduledEvents.size)
  }

  // Cleanup
  destroy() {
    this.tweenTimeline.kill()
    this.scheduledEvents.clear()
    this.timeEffects.clear()
  }
}

// Create a singleton instance
const timeManager = new TimeManager()

// Export both the instance and the class
export { timeManager, TimeManager }