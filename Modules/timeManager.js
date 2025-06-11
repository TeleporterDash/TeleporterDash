// Modules/timeManager.js

class TimeManager {
  constructor() {
    this.lastTime = 0
    this.deltaTime = 0
    this.timeScale = 1.0
    this.paused = false
    this.accumulator = 0
    this.fixedTimeStep = 1 / 60 // 60 FPS fixed timestep
    this.scaledDelta = 0
  }

  // Call this at the start of each frame
  update(currentTime) {
    if (!currentTime) currentTime = performance.now()

    // Calculate raw delta time in seconds
    const rawDelta = (currentTime - (this.lastTime || currentTime)) / 1000
    this.lastTime = currentTime

    // Apply time scale and cap max delta to prevent spiral of death
    this.deltaTime = Math.min(rawDelta * this.timeScale, 0.25)
    this.scaledDelta = this.deltaTime * this.timeScale

    // Update fixed timestep accumulator
    if (!this.paused) {
      this.accumulator += this.deltaTime
    }

    return this.deltaTime
  }

  // Should be called in a loop until it returns false
  runFixedUpdate(callback) {
    if (this.accumulator >= this.fixedTimeStep) {
      callback(this.fixedTimeStep)
      this.accumulator -= this.fixedTimeStep
      return true
    }
    return false
  }

  // Time scaling
  setTimeScale(scale) {
    this.timeScale = Math.max(0, scale)
  }

  // Pause/unpause
  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  // Time scaling effects
  slowMotion(factor = 0.5) {
    this.setTimeScale(factor)
  }

  speedUp(factor = 2.0) {
    this.setTimeScale(factor)
  }

  resetTimeScale() {
    this.setTimeScale(1.0)
  }

  // Get current time in seconds
  get time() {
    return this.lastTime / 1000
  }

  // For interpolation (smooth rendering between fixed updates)
  get interpolationAlpha() {
    return this.accumulator / this.fixedTimeStep
  }
}

// Create a singleton instance
const timeManager = new TimeManager()
export { timeManager, TimeManager }
