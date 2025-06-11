import { debug } from "./logManager.js"

/**
 * MusicSync
 * Handles music synchronization for visual effects and animations
 */
export class MusicSync {
  constructor(audioManager) {
    this.audioManager = audioManager
    this.beatDetector = null
    this.beatCallback = null
    this.timerCallback = null
    this.bpm = 120 // Default BPM
    this.beatInterval = 60 / this.bpm // In seconds
    this.lastBeatTime = 0
    this.isInitialized = false
  }

  /**
   * Initialize the beat detection system
   * @returns {Promise} A promise that resolves when initialization is complete
   */
  async initialize() {
    if (this.isInitialized) return

    try {
      // Check if we already have an AudioContext
      if (!this.audioContext) {
        // Create AudioContext
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()

        // Start a dummy oscillator to ensure context is running
        const oscillator = this.audioContext.createOscillator()
        oscillator.connect(this.audioContext.destination)
        oscillator.start()
        oscillator.stop(this.audioContext.currentTime + 0.001)
      }

      // Create analyser
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 2048
      this.analyser.smoothingTimeConstant = 0.8

      // Create buffer for beat detection
      this.buffer = new Uint8Array(this.analyser.frequencyBinCount)

      // Connect audio source to analyser
      if (this.audioManager && this.audioManager.backgroundMusic) {
        this.audioSource = this.audioContext.createMediaElementSource(this.audioManager.backgroundMusic)
        this.audioSource.connect(this.analyser)
        this.analyser.connect(this.audioContext.destination)
      } else {
        throw new Error("AudioManager or background music not available")
      }

      // Start beat detection
      this.startBeatDetection()
      this.isInitialized = true

      debug("musicSync", "Music synchronization initialized successfully")
    } catch (error) {
      error("musicSync", "Failed to initialize music synchronization:", error)
      this.isInitialized = false
      throw error
    }
  }

  /**
   * Start beat detection
   */
  startBeatDetection() {
    this.beatDetector = setInterval(() => {
      this.analyser.getByteFrequencyData(this.buffer)
      const average = this.buffer.reduce((a, b) => a + b) / this.buffer.length

      // Simple beat detection - adjust threshold as needed
      const threshold = 100
      if (average > threshold) {
        this.triggerBeat()
      }
    }, 100) // Check every 100ms
  }

  /**
   * Trigger beat event
   */
  triggerBeat() {
    const currentTime = this.audioManager.backgroundMusic.currentTime
    const timeSinceLastBeat = currentTime - this.lastBeatTime

    // Only trigger if enough time has passed since last beat
    if (timeSinceLastBeat > this.beatInterval * 0.5) {
      this.lastBeatTime = currentTime
      if (this.beatCallback) {
        this.beatCallback(currentTime)
      }
    }
  }

  /**
   * Set callback for beat events
   * @param {Function} callback - Function to call when a beat is detected
   */
  setBeatCallback(callback) {
    this.beatCallback = callback
  }

  /**
   * Set callback for timer events
   * @param {Function} callback - Function to call at regular intervals
   * @param {number} interval - Interval in seconds
   */
  setTimerCallback(callback, interval = 1) {
    this.timerCallback = callback
    this.timerInterval = interval
  }

  /**
   * Update synchronization
   * @param {number} deltaTime - Time since last update
   */
  update(deltaTime) {
    // Update timer-based sync
    if (this.timerCallback) {
      const currentTime = this.audioManager.backgroundMusic.currentTime
      const timeSinceLastBeat = currentTime - this.lastBeatTime

      if (timeSinceLastBeat >= this.timerInterval) {
        this.lastBeatTime = currentTime
        this.timerCallback(currentTime)
      }
    }
  }

  /**
   * Clean up resources
   */
  reset() {
    if (this.beatDetector) {
      clearInterval(this.beatDetector)
      this.beatDetector = null
    }
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.isInitialized = false
  }

  /**
   * Get current beat time
   * @returns {number} Current time in seconds
   */
  getCurrentTime() {
    return this.audioManager.backgroundMusic.currentTime
  }

  /**
   * Set BPM
   * @param {number} bpm - Beats per minute
   */
  setBPM(bpm) {
    this.bpm = bpm
    this.beatInterval = 60 / this.bpm
  }

  /**
   * Get current BPM
   * @returns {number} Current BPM
   */
  getBPM() {
    return this.bpm
  }
}
