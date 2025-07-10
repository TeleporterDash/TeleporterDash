/**
 * AudioManager
 * Handles all audio-related functionality for Teleporter Dash
 * Including background music, practice mode music, and sound effects
 * Refactored to use Howler.js for better audio management
 */

import { Howl, Howler } from 'howler'
import { warn, error, debug, verbose } from "./logManager.js"

export default class AudioManager {
  constructor() {
    this.backgroundMusic = null
    this.practiceMusic = null
    this.jumpSound = null
    this.deathSound = null
    this.completionSound = null
    this.achievementSound = null
    
    this.isMuted = false
    this.isInitialized = false
    this.isMusicPlaying = false
    this.restartMusicOnDeath = true
    this.restartMusicOnCompletion = true
    
    // Store current playback positions for resuming
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0
    this.lastMusicTime = 0
    
    // Default volume levels
    this.volumes = {
      backgroundMusic: 0.6,
      practiceMusic: 0.6,
      jumpSound: 0.2,
      deathSound: 0.7,
      completionSound: 0.7,
      achievementSound: 0.5
    }
  }

  /**
   * Initialize audio elements with Howler.js
   * @param {string} levelMusicPath - Path to the level's music file
   * @returns {Promise} A promise that resolves when initialization is complete
   */
  async initialize(levelMusicPath = "../Sound/Basic Soundeffects/practicetd-Dashback") {
    if (this.isInitialized && levelMusicPath) {
      // If already initialized, just update the background music
      await this.updateBackgroundMusic(levelMusicPath)
      return
    }

    try {
      // Initialize background music
      this.backgroundMusic = new Howl({
        src: [
          `${levelMusicPath}.mp3`,
          `${levelMusicPath}.ogg`,
          `${levelMusicPath}.wav`
        ],
        loop: true,
        volume: this.volumes.backgroundMusic,
        onload: () => debug("audioManager", "Background music loaded"),
        onloaderror: (id, err) => error("audioManager", "Background music load error:", err),
        onplay: () => {
          this.isMusicPlaying = true
          debug("audioManager", "Background music started playing")
        },
        onpause: () => {
          this.isMusicPlaying = false
          this.backgroundMusicTime = this.backgroundMusic.seek()
          debug("audioManager", "Background music paused")
        },
        onstop: () => {
          this.isMusicPlaying = false
          debug("audioManager", "Background music stopped")
        },
        onend: () => {
          this.isMusicPlaying = false
          debug("audioManager", "Background music ended")
        }
      })

      // Initialize practice music
      this.practiceMusic = new Howl({
        src: [
          "../Sound/Basic Soundeffects/practicetd-Dashback.mp3",
          "../Sound/Basic Soundeffects/practicetd-Dashback.ogg"
        ],
        loop: true,
        volume: this.volumes.practiceMusic,
        onload: () => debug("audioManager", "Practice music loaded"),
        onloaderror: (id, err) => error("audioManager", "Practice music load error:", err)
      })

      // Initialize sound effects
      this.jumpSound = new Howl({
        src: [
          "../Sound/Basic Soundeffects/jumptd.mp3",
          "../Sound/Basic Soundeffects/jumptd.ogg"
        ],
        volume: this.volumes.jumpSound,
        onload: () => debug("audioManager", "Jump sound loaded"),
        onloaderror: (id, err) => error("audioManager", "Jump sound load error:", err)
      })

      this.deathSound = new Howl({
        src: [
          "../Sound/Basic Soundeffects/deathtd.mp3",
          "../Sound/Basic Soundeffects/deathtd.ogg"
        ],
        volume: this.volumes.deathSound,
        onload: () => debug("audioManager", "Death sound loaded"),
        onloaderror: (id, err) => error("audioManager", "Death sound load error:", err)
      })

      this.completionSound = new Howl({
        src: [
          "../Sound/Basic Soundeffects/lvlcompletetd.mp3",
          "../Sound/Basic Soundeffects/lvlcompletetd.ogg"
        ],
        volume: this.volumes.completionSound,
        onload: () => debug("audioManager", "Completion sound loaded"),
        onloaderror: (id, err) => error("audioManager", "Completion sound load error:", err)
      })

      this.achievementSound = new Howl({
        src: [
          "../Sound/Basic Soundeffects/achievementstd.mp3",
          "../Sound/Basic Soundeffects/achievementstd.ogg"
        ],
        volume: this.volumes.achievementSound,
        onload: () => debug("audioManager", "Achievement sound loaded"),
        onloaderror: (id, err) => error("audioManager", "Achievement sound load error:", err)
      })

      this.isInitialized = true
      debug("audioManager", "Audio manager initialized successfully with Howler.js")
      
      // Wait for all sounds to load
      await this.waitForLoad()
      
    } catch (err) {
      error("audioManager", "Audio initialization failed:", err)
      throw err
    }
  }

  /**
   * Update background music with a new track
   * @param {string} levelMusicPath - Path to the new music file
   */
  async updateBackgroundMusic(levelMusicPath) {
    if (this.backgroundMusic) {
      this.backgroundMusic.stop()
      this.backgroundMusic.unload()
    }

    this.backgroundMusic = new Howl({
      src: [
        `${levelMusicPath}.mp3`,
        `${levelMusicPath}.ogg`,
        `${levelMusicPath}.wav`
      ],
      loop: true,
      volume: this.volumes.backgroundMusic,
      onload: () => debug("audioManager", "New background music loaded"),
      onloaderror: (id, err) => error("audioManager", "New background music load error:", err),
      onplay: () => {
        this.isMusicPlaying = true
        debug("audioManager", "New background music started playing")
      },
      onpause: () => {
        this.isMusicPlaying = false
        this.backgroundMusicTime = this.backgroundMusic.seek()
      },
      onstop: () => {
        this.isMusicPlaying = false
      }
    })

    await this.waitForSoundLoad(this.backgroundMusic)
  }

  /**
   * Setup audio for a level
   * @param {string} levelMusicPath - Path to the level's music file
   * @returns {Promise} A promise that resolves when setup is complete
   */
  async setup(levelMusicPath) {
    await this.initialize(levelMusicPath)
    
    // Update volumes from settings
    this.updateVolumes()
    
    // Apply mute state
    if (this.isMuted) {
      this.muteAll()
    }
  }

  /**
   * Wait for all sounds to load
   * @returns {Promise} A promise that resolves when all sounds are loaded
   */
  async waitForLoad() {
    const sounds = [
      this.backgroundMusic,
      this.practiceMusic,
      this.jumpSound,
      this.deathSound,
      this.completionSound,
      this.achievementSound
    ].filter(Boolean)

    const loadPromises = sounds.map(sound => this.waitForSoundLoad(sound))
    await Promise.all(loadPromises)
  }

  /**
   * Wait for a specific sound to load
   * @param {Howl} sound - The Howl instance to wait for
   * @returns {Promise} A promise that resolves when the sound is loaded
   */
  waitForSoundLoad(sound) {
    return new Promise((resolve, reject) => {
      if (sound.state() === 'loaded') {
        resolve()
        return
      }

      const onLoad = () => {
        sound.off('load', onLoad)
        sound.off('loaderror', onError)
        resolve()
      }

      const onError = (id, err) => {
        sound.off('load', onLoad)
        sound.off('loaderror', onError)
        reject(err)
      }

      sound.on('load', onLoad)
      sound.on('loaderror', onError)
    })
  }

  /**
   * Update volume levels from settings
   */
  updateVolumes() {
    const volumeLevel = document.getElementById("volumeSlider")
      ? document.getElementById("volumeSlider").value / 100
      : 0.5

    if (this.backgroundMusic) {
      this.backgroundMusic.volume(volumeLevel * this.volumes.backgroundMusic)
    }
    if (this.practiceMusic) {
      this.practiceMusic.volume(volumeLevel * this.volumes.practiceMusic)
    }
    if (this.jumpSound) {
      this.jumpSound.volume(volumeLevel * this.volumes.jumpSound)
    }
    if (this.deathSound) {
      this.deathSound.volume(volumeLevel * this.volumes.deathSound)
    }
    if (this.completionSound) {
      this.completionSound.volume(volumeLevel * this.volumes.completionSound)
    }
    if (this.achievementSound) {
      this.achievementSound.volume(volumeLevel * this.volumes.achievementSound)
    }
  }

  /**
   * Play the background music
   */
  playBackgroundMusic() {
    if (!this.isMuted && this.backgroundMusic && !this.isMusicPlaying) {
      verbose("audioManager", `Playing background music from ${this.backgroundMusicTime}s`)
      
      if (this.backgroundMusicTime > 0) {
        this.backgroundMusic.seek(this.backgroundMusicTime)
      }
      
      this.backgroundMusic.play()
    }
  }

  /**
   * Pause the background music
   */
  pauseBackgroundMusic() {
    if (this.backgroundMusic && this.isMusicPlaying) {
      this.backgroundMusic.pause()
    }
  }

  /**
   * Restart the background music
   */
  async restart() {
    if (this.backgroundMusic) {
      this.backgroundMusic.stop()
      this.backgroundMusicTime = 0
      if (!this.isMuted) {
        this.backgroundMusic.play()
      }
    }
  }

  /**
   * Switch between background and practice music
   * @param {boolean} isPracticeMode - Whether to switch to practice mode
   */
  switchTracks(isPracticeMode) {
    if (isPracticeMode) {
      // Switch to practice music
      if (this.backgroundMusic && this.backgroundMusic.playing()) {
        this.backgroundMusicTime = this.backgroundMusic.seek()
        this.backgroundMusic.pause()
      }
      
      if (this.practiceMusic && !this.isMuted) {
        if (this.practiceMusicTime > 0) {
          this.practiceMusic.seek(this.practiceMusicTime)
        }
        this.practiceMusic.play()
      }
    } else {
      // Switch to background music
      if (this.practiceMusic && this.practiceMusic.playing()) {
        this.practiceMusicTime = this.practiceMusic.seek()
        this.practiceMusic.pause()
      }
      
      if (this.backgroundMusic && !this.isMuted) {
        if (this.backgroundMusicTime > 0) {
          this.backgroundMusic.seek(this.backgroundMusicTime)
        }
        this.backgroundMusic.play()
      }
    }
  }

  /**
   * Fade out audio
   * @param {Howl} sound - The sound to fade out
   * @param {number} duration - Duration of the fade in milliseconds
   * @returns {Promise} A promise that resolves when the fade is complete
   */
  fadeOut(sound, duration = 1000) {
    return new Promise((resolve) => {
      if (!sound || !sound.playing()) {
        resolve()
        return
      }

      const currentVolume = sound.volume()
      sound.fade(currentVolume, 0, duration)
      
      setTimeout(() => {
        sound.stop()
        sound.volume(currentVolume) // Reset volume for next time
        resolve()
      }, duration)
    })
  }

  /**
   * Play the jump sound effect
   */
  playJumpSound() {
    if (!this.isMuted && this.jumpSound) {
      this.jumpSound.play()
    }
  }

  /**
   * Play the death sound effect
   */
  playDeathSound() {
    if (!this.isMuted && this.deathSound) {
      this.deathSound.play()
      
      // Handle music restart behavior
      if (!this.restartMusicOnDeath && this.backgroundMusic) {
        this.backgroundMusicTime = this.backgroundMusic.seek()
      } else {
        this.backgroundMusicTime = 0
      }
    }
  }

  /**
   * Play the level completion sound effect and fade out background music
   * @param {boolean} isPracticeMode - Whether the game is in practice mode
   */
  async playCompletionSound(isPracticeMode = false) {
    if (!this.isMuted && this.completionSound) {
      this.completionSound.play()
      
      // Fade out current music
      const currentMusic = isPracticeMode ? this.practiceMusic : this.backgroundMusic
      if (currentMusic) {
        await this.fadeOut(currentMusic)
      }
      
      // Handle music restart behavior
      if (!this.restartMusicOnCompletion && this.backgroundMusic) {
        this.backgroundMusicTime = this.backgroundMusic.seek() || this.backgroundMusicTime
      } else {
        this.backgroundMusicTime = 0
      }
    }
  }

  /**
   * Play the achievement sound effect
   */
  playAchievementSound() {
    if (!this.isMuted && this.achievementSound) {
      this.achievementSound.play()
    }
  }

  /**
   * Toggle audio mute state
   */
  toggleMute() {
    this.isMuted = !this.isMuted
    
    // Update SettingsManager if available
    if (typeof SettingsManager !== "undefined" && SettingsManager?.current) {
      SettingsManager.current.isMuted = this.isMuted
      SettingsManager.save()
    }
    
    // Apply mute state using Howler's global mute
    Howler.mute(this.isMuted)
    
    debug("audioManager", `Audio ${this.isMuted ? 'muted' : 'unmuted'}`)
  }

  /**
   * Mute all audio
   */
  muteAll() {
    this.isMuted = true
    Howler.mute(true)
    debug("audioManager", "All audio muted")
  }

  /**
   * Unmute all audio
   */
  unmuteAll() {
    this.isMuted = false
    Howler.mute(false)
    debug("audioManager", "All audio unmuted")
  }

  /**
   * Reset mute state to ensure music plays when opening a new level
   */
  resetMuteState() {
    this.isMuted = false
    Howler.mute(false)
    
    // Update SettingsManager if available
    if (typeof SettingsManager !== "undefined" && SettingsManager?.current) {
      SettingsManager.current.isMuted = false
      SettingsManager.save()
    }
    
    // Reset music times
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0
    this.lastMusicTime = 0
    
    debug("audioManager", "Mute state reset")
  }

  /**
   * Reset AudioManager state
   */
  reset() {
    debug("audioManager", "Resetting AudioManager state...")
    
    // Stop all sounds
    const sounds = [
      this.backgroundMusic,
      this.practiceMusic,
      this.jumpSound,
      this.deathSound,
      this.completionSound,
      this.achievementSound
    ]
    
    sounds.forEach(sound => {
      if (sound) {
        sound.stop()
      }
    })
    
    // Reset state
    this.isMusicPlaying = false
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0
    this.lastMusicTime = 0
    
    debug("audioManager", "AudioManager reset complete")
  }

  /**
   * Clean up all audio resources
   */
  cleanup() {
    debug("audioManager", "Cleaning up AudioManager...")
    
    // Stop and unload all sounds
    const sounds = [
      this.backgroundMusic,
      this.practiceMusic,
      this.jumpSound,
      this.deathSound,
      this.completionSound,
      this.achievementSound
    ]
    
    sounds.forEach(sound => {
      if (sound) {
        sound.stop()
        sound.unload()
      }
    })
    
    // Reset all references
    this.backgroundMusic = null
    this.practiceMusic = null
    this.jumpSound = null
    this.deathSound = null
    this.completionSound = null
    this.achievementSound = null
    
    // Reset state
    this.isMusicPlaying = false
    this.backgroundMusicTime = 0
    this.practiceMusicTime = 0
    this.lastMusicTime = 0
    this.isInitialized = false
    
    debug("audioManager", "AudioManager cleanup complete")
  }
}