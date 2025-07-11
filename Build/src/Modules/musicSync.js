import { debug } from "./logManager.js"
import gsap from "gsap"

export class MusicSync {
  constructor(audioManager, options = {}) {
    this.audioManager = audioManager
    this.useHowler = options.useHowler ?? true  // default true for Howler.js now
    this.beatCallback = null
    this.timerCallback = null
    this.pulseCallback = null

    this.bpm = options.bpm || 120
    this.beatInterval = 60 / this.bpm
    this.lastBeatTime = 0

    this.energyHistory = []
    this.maxHistory = 43 // ~1 sec at 1024 sample rate
    this.energyThresholdFactor = 1.3

    this.initialized = false
    this.running = false
  }

  async initialize() {
    if (this.initialized) return

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
        await this.audioContext.resume()
      }

      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 1024
      this.buffer = new Uint8Array(this.analyser.frequencyBinCount)

      if (!this.audioManager?.backgroundMusic) {
        throw new Error("No backgroundMusic in AudioManager")
      }

      let mediaElement
      if (this.useHowler) {
        // Access Howler's internal audio element from Howl instance
        const howl = this.audioManager.backgroundMusic
        if (!howl._sounds || howl._sounds.length === 0) {
          throw new Error("Howler backgroundMusic has no sound nodes loaded yet")
        }
        mediaElement = howl._sounds[0]._node
        if (!mediaElement) {
          throw new Error("Could not access underlying HTMLAudioElement from Howler")
        }
      } else {
        // fallback if using raw HTMLAudioElement
        mediaElement = this.audioManager.backgroundMusic
      }

      // Create MediaElementSource only once per AudioContext lifetime
      if (this.audioSource) {
        this.audioSource.disconnect()
      }
      this.audioSource = this.audioContext.createMediaElementSource(mediaElement)
      this.audioSource.connect(this.analyser)
      this.analyser.connect(this.audioContext.destination)

      this.initialized = true
      this.running = true
      this.startDetectionLoop()

      debug("musicSync", "Initialized successfully with Howler audio source")
    } catch (e) {
      console.error("musicSync", "Initialization failed:", e)
      throw e
    }
  }

  startDetectionLoop() {
    const loop = () => {
      if (!this.running) return
      this.analyser.getByteFrequencyData(this.buffer)

      const currentEnergy = this.buffer.reduce((a, b) => a + b, 0)
      this.energyHistory.push(currentEnergy)
      if (this.energyHistory.length > this.maxHistory) {
        this.energyHistory.shift()
      }

      const avgEnergy =
        this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length
      const threshold = avgEnergy * this.energyThresholdFactor

      if (currentEnergy > threshold) {
        this.triggerBeat()
      }

      if (this.timerCallback) {
        // Use Howler seek time or fallback to 0
        const now = this.getCurrentTime()
        const dt = now - this.lastBeatTime
        if (dt >= this.beatInterval) {
          this.lastBeatTime = now
          this.timerCallback(now)
        }
      }

      requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
  }

  triggerBeat() {
    const currentTime = this.getCurrentTime()
    if (this.beatCallback) this.beatCallback(currentTime)

    if (this.pulseCallback) this.pulseCallback()

    gsap.to("body", {
      backgroundColor: "#fff",
      duration: 0.05,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut"
    })
  }

  setBeatCallback(cb) {
    this.beatCallback = cb
  }

  setTimerCallback(cb, interval = 1) {
    this.timerCallback = cb
    this.beatInterval = interval
  }

  setPulseCallback(cb) {
    this.pulseCallback = cb
  }

  getCurrentTime() {
    if (!this.audioManager?.backgroundMusic) return 0
    if (this.useHowler) {
      try {
        // Howler seek() returns current playback position in seconds
        return this.audioManager.backgroundMusic.seek() || 0
      } catch {
        return 0
      }
    } else {
      // raw HTMLAudioElement fallback
      return this.audioManager.backgroundMusic.currentTime || 0
    }
  }

  setBPM(bpm) {
    this.bpm = bpm
    this.beatInterval = 60 / bpm
  }

  getBPM() {
    return this.bpm
  }

  reset() {
    this.running = false
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    this.analyser = null
    if (this.audioSource) {
      this.audioSource.disconnect()
      this.audioSource = null
    }
    this.energyHistory = []
    this.initialized = false
  }
}
export default MusicSync;