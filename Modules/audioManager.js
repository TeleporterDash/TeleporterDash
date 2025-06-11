/**
 * AudioManager
 * Handles all audio-related functionality for Teleporter Dash
 * Including background music, practice mode music, and sound effects
 */

import { warn, error, debug, verbose } from "./logManager.js"

export default class AudioManager {
  constructor() {
    this.backgroundMusic = null
    this.practiceMusic = null
    this.jumpSound = null
    this.deathSound = null
    this.completionSound = null
    this.isMuted = false
    this.lastMusicTime = 0
    this.isInitialized = false
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0
    this.isMusicPlaying = false // Track if music is currently playing
    this.restartMusicOnDeath = true // Whether to restart music on death
    this.restartMusicOnCompletion = true // Whether to restart music on level completion

    // Store event listeners to enable proper removal
    this.eventListeners = new Map()
  }

  /**
   * Detect if the browser is Safari
   * @returns {boolean} True if the browser is Safari
   */
  isSafari() {
    const userAgent = navigator.userAgent.toLowerCase()
    return userAgent.includes("safari") && !userAgent.includes("chrome")
  }

  /**
   * Play audio from the specified time
   * @param {HTMLAudioElement} audio - The audio element to play
   * @param {number} startTime - The time to start playback from
   * @returns {Promise} A promise that resolves when playback starts
   */
  async play(audio, startTime = 0) {
    if (!audio) {
      debug("audioManager", "Attempted to play null audio")
      return
    }

    // Prevent duplicate playback but check audio state too in case flag is wrong
    if (this.isMusicPlaying && !audio.paused) {
      debug("audioManager", `Audio already playing: ${audio.src}`)
      return
    }

    try {
      debug("audioManager", `Playing audio: ${audio.src}, startTime: ${startTime}`)
      // Reset the flag before attempting to play to avoid race conditions
      this.isMusicPlaying = false

      // Reset currentTime before playing to ensure we start from the right position
      audio.currentTime = startTime
      await audio.play()
      this.isMusicPlaying = true // Mark as playing

      // Add event listener to detect when playback ends
      this.addAudioEventListener(audio, "ended", () => {
        this.isMusicPlaying = false
      })

      // Add error handler
      this.addAudioEventListener(audio, "error", (e) => {
        error("audioManager", `Audio error: ${e.message || "Unknown error"}`)
        this.isMusicPlaying = false
      })
    } catch (err) {
      error("audioManager", `Error playing audio: ${err.message}`)
      this.isMusicPlaying = false
    }
  }

  /**
   * Pause the specified audio
   * @param {HTMLAudioElement} audio - The audio element to pause
   * @returns {Promise} A promise that resolves when the audio is paused
   */
  async pause(audio) {
    if (!audio) {
      debug("audioManager", "Attempted to pause null audio")
      return
    }
    try {
      debug("audioManager", `Pausing audio: ${audio.src}`)
      audio.pause()
    } catch (err) {
      error("audioManager", `Error pausing audio: ${err.message}`)
    }
  }

  /**
   * Switch between two audio tracks
   * @param {HTMLAudioElement} trackToPlay - The track to start playing
   * @param {HTMLAudioElement} trackToPause - The track to pause
   * @returns {Promise} A promise that resolves when the switch is complete
   */
  async switchTracks(trackToPlay, trackToPause) {
    if (!trackToPlay || !trackToPause) return
    const currentTime = trackToPause.currentTime
    await this.pause(trackToPause)
    if (!this.isMuted) {
      await this.play(trackToPlay, currentTime)
    }
  }

  /**
   * Initialize audio elements
   * @param {string} levelMusicPath - Path to the level's music file
   * @returns {Promise} A promise that resolves when initialization is complete
   */
  async initialize(levelMusicPath = "../Sound/Basic Soundeffects/practicetd-Dashback.mp3") {
    if (this.isInitialized) {
      // If already initialized, just update the background music source if a new path is provided
      if (levelMusicPath) {
        await this.pause(this.backgroundMusic)
        this.backgroundMusic = new Audio(levelMusicPath)
        this.backgroundMusic.loop = true
      }
      return
    }

    // Initialize all audio elements with MP3 or OGG based on browser
    const musicPath =
      this.isSafari() && !levelMusicPath.endsWith(".mp3") ? levelMusicPath.replace(/\.[^.]*$/, ".mp3") : levelMusicPath
    const practiceMusicPath = this.isSafari()
      ? "../Sound/Basic Soundeffects/practicetd-Dashback.ogg".replace(".ogg", ".mp3")
      : "../Sound/Basic Soundeffects/practicetd-Dashback.ogg"
    const jumpSoundPath = this.isSafari()
      ? "../Sound/Basic Soundeffects/jumptd.ogg".replace(".ogg", ".mp3")
      : "../Sound/Basic Soundeffects/jumptd.ogg"
    const deathSoundPath = this.isSafari()
      ? "../Sound/Basic Soundeffects/deathtd.ogg".replace(".ogg", ".mp3")
      : "../Sound/Basic Soundeffects/deathtd.ogg"
    const completionSoundPath = this.isSafari()
      ? "../Sound/Basic Soundeffects/lvlcompletetd.ogg".replace(".ogg", ".mp3")
      : "../Sound/Basic Soundeffects/lvlcompletetd.ogg"

    // Initialize the audio elements
    this.backgroundMusic = new Audio(musicPath)
    this.practiceMusic = new Audio(practiceMusicPath)
    this.jumpSound = new Audio(jumpSoundPath)
    this.deathSound = new Audio(deathSoundPath)
    this.completionSound = new Audio(completionSoundPath)

    this.isInitialized = true
    debug("audioManager", "Audio manager initialized successfully")
  }

  /**
   * Setup audio for a level
   * @param {string} levelMusicPath - Path to the level's music file
   * @returns {Promise} A promise that resolves when setup is complete
   */
  async setup(levelMusicPath) {
    // Initialize or update audio elements
    await this.initialize(levelMusicPath)

    try {
      // Set audio properties
      this.backgroundMusic.loop = true
      this.practiceMusic.loop = true

      // Set volumes from settings
      const volumeLevel = document.getElementById("volumeSlider")
        ? document.getElementById("volumeSlider").value / 100
        : 0.5

      this.backgroundMusic.volume = volumeLevel * 0.6
      this.practiceMusic.volume = volumeLevel * 0.6
      this.jumpSound.volume = volumeLevel * 0.2
      this.deathSound.volume = volumeLevel * 0.7
      this.completionSound.volume = volumeLevel * 0.7

      // Set initial mute states
      ;[this.backgroundMusic, this.practiceMusic, this.jumpSound, this.deathSound, this.completionSound].forEach(
        (audio) => {
          if (audio) audio.muted = this.isMuted
        },
      )

      // Create load promises for each audio element
      const loadPromises = [
        this.createLoadPromise(this.backgroundMusic),
        this.createLoadPromise(this.practiceMusic),
        this.createLoadPromise(this.jumpSound),
        this.createLoadPromise(this.deathSound),
        this.createLoadPromise(this.completionSound),
      ]

      // Start loading all audio files
      this.backgroundMusic.load()
      this.practiceMusic.load()
      this.jumpSound.load()
      this.deathSound.load()
      this.completionSound.load()

      // Wait for all audio to be ready
      await Promise.all(loadPromises)
      debug("audioManager", "All audio loaded successfully")
    } catch (err) {
      error("audioManager", "Audio setup failed:", err)
      throw err
    }
  }

  /**
   * Restart the background music
   * @returns {Promise} A promise that resolves when the audio restarts
   */
  async restart() {
    if (this.backgroundMusic) {
      this.backgroundMusic.currentTime = 0
      if (!this.isMuted) {
        try {
          await this.play(this.backgroundMusic)
        } catch (err) {
          error("audioManager", "Failed to restart audio:", err)
        }
      }
    }
  }

  /**
   * Create a promise that resolves when an audio element is ready to play
   * @param {HTMLAudioElement} audio - The audio element
   * @returns {Promise} A promise that resolves when the audio can play through
   */
  createLoadPromise(audio) {
    return new Promise((resolve, reject) => {
      this.addAudioEventListener(audio, "canplaythrough", resolve)
      this.addAudioEventListener(audio, "error", reject)
    })
  }

  /**
   * Fade out an audio element
   * @param {HTMLAudioElement} audio - The audio element to fade out
   * @param {number} duration - Duration of the fade in milliseconds
   * @returns {Promise} A promise that resolves when the fade is complete
   */
  async fadeOut(audio, duration = 1000) {
    if (!audio || audio.paused) return

    const startVolume = audio.volume
    const steps = 20
    const stepTime = duration / steps
    const volumeStep = startVolume / steps

    for (let i = steps; i > 0; i--) {
      audio.volume = volumeStep * i
      await new Promise((resolve) => setTimeout(resolve, stepTime))
    }

    await this.pause(audio)
    audio.volume = startVolume
  }

  /**
   * Toggle audio mute state
   */
  toggleMute() {
    this.isMuted = !this.isMuted

    // If SettingsManager exists and has a current property, update it
    if (typeof SettingsManager !== "undefined" && SettingsManager && SettingsManager.current) {
      SettingsManager.current.isMuted = this.isMuted
      SettingsManager.save()
    }

    // Apply mute state to all audio elements
    const allAudio = [this.backgroundMusic, this.practiceMusic, this.jumpSound, this.deathSound, this.completionSound]

    allAudio.forEach((audio) => {
      if (audio) {
        audio.muted = this.isMuted
      }
    })

    // If unmuting and music should be playing, resume playback
    if (!this.isMuted && this.backgroundMusic && !this.isMusicPlaying) {
      this.backgroundMusic.currentTime = this.backgroundMusicTime
      this.backgroundMusic.play().catch((err) => {
        error("audioManager", "Failed to resume background music:", err)
      })
    }

    // Update volume for all audio elements
    allAudio.forEach((audio) => {
      if (audio && typeof SettingsManager !== "undefined" && SettingsManager && SettingsManager.current) {
        audio.volume = SettingsManager.current.volume / 100
      }
    })
  }

  /**
   * Play the jump sound effect
   */
  playJumpSound() {
    if (!this.isMuted && this.jumpSound) {
      this.jumpSound.currentTime = 0
      this.jumpSound.play().catch((err) => error("audioManager", "Jump sound failed:", err))
    }
  }

  /**
   * Play the death sound effect and handle music restart/continue
   */
  async playDeathSound() {
    if (!this.isMuted && this.deathSound) {
      this.deathSound.currentTime = 0
      this.deathSound.play().catch((err) => error("audioManager", "Death sound failed:", err))

      // If restartMusicOnDeath is false, save current time
      if (!this.restartMusicOnDeath && this.backgroundMusic) {
        this.backgroundMusicTime = this.backgroundMusic.currentTime
      } else {
        this.backgroundMusicTime = 0
      }
    }
  }

  /**
   * Play the level completion sound effect and fade out background music
   * @param {boolean} isPracticeMode - Whether the game is in practice mode
   */
  async playCompletionSound(isPracticeMode) {
    if (!this.isMuted) {
      this.completionSound.currentTime = 0
      this.completionSound.play()

      // Fade out current music
      await this.fadeOut(isPracticeMode ? this.practiceMusic : this.backgroundMusic)

      // If restartMusicOnCompletion is false, save current time
      if (!this.restartMusicOnCompletion && this.backgroundMusic) {
        this.backgroundMusicTime = this.backgroundMusic.currentTime
      } else {
        this.backgroundMusicTime = 0
      }
    }
  }

  /**
   * Play the achievement sound effect
   */
  playAchievementSound() {
    const achievementSound = new Audio("../Sound/Basic Soundeffects/achievementstd.mp3")
    achievementSound.volume = 0.5
    achievementSound.play().catch((err) => error("audioManager", "Achievement sound failed:", err))
  }

  /**
   * Pause the background music
   */
  pauseBackgroundMusic() {
    if (this.backgroundMusic) {
      this.backgroundMusic.pause()
      this.backgroundMusicTime = this.backgroundMusic.currentTime
    }
  }

  /**
   * Play the background music
   */
  playBackgroundMusic() {
    if (!this.isMuted && this.backgroundMusic) {
      verbose("audioManager", `Attempting to play background music from ${this.backgroundMusicTime}s`)

      // Store the time before playing to avoid race conditions
      const startFrom = this.backgroundMusicTime

      // First pause the music to ensure we can set the time properly
      this.backgroundMusic.pause()

      // Set the current time explicitly
      this.backgroundMusic.currentTime = startFrom

      // Now play from the saved position
      this.backgroundMusic.play().catch((err) => {
        error("audioManager", `Failed to play background music from ${startFrom}s:`, err)
        // If playback fails, reset the flag to allow future playback attempts
        this.isMusicPlaying = false
      })
    }
  }

  /**
   * Reset mute state to ensure music plays when opening a new level
   * This should be called on level completion
   */
  resetMuteState() {
    // Reset mute state to false
    this.isMuted = false

    // Reset all audio elements' muted property
    const allAudio = [this.backgroundMusic, this.practiceMusic, this.jumpSound, this.deathSound, this.completionSound]
    allAudio.forEach((audio) => {
      if (audio) {
        audio.muted = false
      }
    })

    // Update SettingsManager if it exists and has a current property
    if (typeof SettingsManager !== "undefined" && SettingsManager && SettingsManager.current) {
      SettingsManager.current.isMuted = false
      SettingsManager.save()
    }

    // Reset the music times
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0
    this.lastMusicTime = 0
  }

  /**
   * Reset AudioManager state
   */
  reset() {
    debug("AudioManager", "Resetting AudioManager state...")

    // Stop all sounds immediately
    const audioElements = [
      this.backgroundMusic,
      this.practiceMusic,
      this.jumpSound,
      this.deathSound,
      this.completionSound,
    ]

    // Pause and clear event listeners for each audio element
    audioElements.forEach((audioElement) => {
      if (audioElement) {
        this.pause(audioElement)
        this.clearAudioEventListeners(audioElement)
      }
    })

    // Reset audio-related state
    this.isMusicPlaying = false
    this.lastMusicTime = 0
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0

    // Explicitly reset mute state to its original setting
    if (this.isMuted) {
      this.muteAll()
    } else {
      this.unmuteAll()
    }

    debug("AudioManager", "AudioManager reset complete.")
  }

  /**
   * Mute all audio elements
   */
  muteAll() {
    const audioElements = [
      this.backgroundMusic,
      this.practiceMusic,
      this.jumpSound,
      this.deathSound,
      this.completionSound,
    ]

    audioElements.forEach((audioElement) => {
      if (audioElement) {
        audioElement.muted = true
      }
    })

    this.isMuted = true
    debug("audioManager", "All audio muted")
  }

  /**
   * Unmute all audio elements
   */
  unmuteAll() {
    const audioElements = [
      this.backgroundMusic,
      this.practiceMusic,
      this.jumpSound,
      this.deathSound,
      this.completionSound,
    ]

    audioElements.forEach((audioElement) => {
      if (audioElement) {
        audioElement.muted = false
      }
    })

    this.isMuted = false
    debug("audioManager", "All audio unmuted")
  }

  /**
   * Add an event listener to an audio element with tracking
   * @param {HTMLAudioElement} audioElement - The audio element to add listener to
   * @param {string} eventType - The type of event (e.g., 'ended', 'pause')
   * @param {Function} callback - The event handler function
   */
  addAudioEventListener(audioElement, eventType, callback) {
    if (!audioElement) {
      warn("audioManager", `Cannot add ${eventType} listener to null audio element`)
      return
    }

    // Store the listener for potential removal
    if (!this.eventListeners.has(audioElement)) {
      this.eventListeners.set(audioElement, new Map())
    }

    const elementListeners = this.eventListeners.get(audioElement)
    elementListeners.set(eventType, callback)

    audioElement.addEventListener(eventType, callback)
  }

  /**
   * Remove a specific event listener from an audio element
   * @param {HTMLAudioElement} audioElement - The audio element to remove listener from
   * @param {string} eventType - The type of event to remove
   */
  removeAudioEventListener(audioElement, eventType) {
    if (!audioElement) return

    const elementListeners = this.eventListeners.get(audioElement)
    if (elementListeners && elementListeners.has(eventType)) {
      const callback = elementListeners.get(eventType)
      audioElement.removeEventListener(eventType, callback)
      elementListeners.delete(eventType)
    }
  }

  /**
   * Remove all event listeners for a specific audio element
   * @param {HTMLAudioElement} audioElement - The audio element to remove all listeners from
   */
  clearAudioEventListeners(audioElement) {
    if (!audioElement) return

    const elementListeners = this.eventListeners.get(audioElement)
    if (elementListeners) {
      for (const [eventType, callback] of elementListeners) {
        audioElement.removeEventListener(eventType, callback)
      }
      this.eventListeners.delete(audioElement)
    }
  }

  /**
   * Clean up all audio event listeners
   */
  cleanup() {
    // Remove listeners from all tracked audio elements
    for (const audioElement of this.eventListeners.keys()) {
      this.clearAudioEventListeners(audioElement)
    }

    // Reset audio-related state
    this.isMusicPlaying = false
    this.lastMusicTime = 0
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0

    debug("audioManager", "Audio manager cleaned up")
  }
}
