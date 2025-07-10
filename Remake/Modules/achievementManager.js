// Modules/achievementManager.js
import { log, warn, error, debug, setLogLevel } from "./logManager.js"
import { getSprite } from "./spriteManager.js"
import AudioManager from "./audioManager.js"
import { StorageManager } from "./storageManager.js"

// Constants
const STORAGE_KEY = "achievements"
const LOG_CONTEXT = "achievementManager"

// Achievement definitions - moved to a separate json
// in `import ../JSON/achievements.json` btw

/**
 * Achievement manager class that handles tracking, unlocking and storing achievements
 */
export class AchievementManager {
  /**
   * Create a new AchievementManager instance
   * @param {Object} options - Configuration options
   * @param {AudioManager} options.audioManager - Audio manager instance
   * @param {PopupManager} options.popupManager - Popup manager instance
   * @param {boolean} options.debugMode - Enable debug mode
   */
  constructor(options = {}) {
    this.achievements = {}
    this.totalPoints = 0
    this.unlockedAchievements = new Set()

    // Dependencies injected through constructor for better testability
    this.audioManager = options.audioManager || new AudioManager()
    this.popupManager = options.popupManager

    // Set log level if debug mode is enabled
    if (options.debugMode) {
      setLogLevel("debug")
    }

    // Initialize achievements
    this.init()
  }

  /**
   * Initialize the achievement manager
   */
  async init() {
    try {
      await this.loadAchievements()
      debug(LOG_CONTEXT, "AchievementManager initialized successfully")
    } catch (err) {
      error(LOG_CONTEXT, "Failed to initialize AchievementManager:", err)
      this.resetAchievements()
    }
  }

  /**
   * Load achievements from storage
   * @returns {Promise<void>}
   */
  async loadAchievements() {
    if (!StorageManager) {
      error(LOG_CONTEXT, "StorageManager not available")
      this.resetAchievements()
      return
    }

    try {
      const saved = await StorageManager.getFromLocalStorage(STORAGE_KEY, STORAGE_KEY)

      if (saved) {
        // Initialize achievements with saved progress
        this.achievements = {}
        this.totalPoints = 0
        this.unlockedAchievements = new Set()

        Object.keys(ACHIEVEMENTS).forEach((id) => {
          // Clone the template achievement
          this.achievements[id] = { ...ACHIEVEMENTS[id] }

          // Apply saved progress if available and valid
          if (saved[id]) {
            const savedProgress = saved[id].progress
            if (typeof savedProgress === "number") {
              // Ensure progress is within valid range
              this.achievements[id].progress = Math.max(0, Math.min(savedProgress, this.achievements[id].maxProgress))

              // Track unlocked achievements
              if (this.achievements[id].progress >= this.achievements[id].maxProgress) {
                this.unlockedAchievements.add(id)
                this.totalPoints += this.achievements[id].points
              }
            }
          }
        })

        debug(LOG_CONTEXT, `Loaded ${this.unlockedAchievements.size} unlocked achievements`)
      } else {
        debug(LOG_CONTEXT, "No saved achievements found, initializing defaults")
        this.resetAchievements()
      }
    } catch (err) {
      warn(LOG_CONTEXT, "Error loading achievements:", err)
      this.resetAchievements()
    }
  }

  /**
   * Reset achievements to default values
   */
  resetAchievements() {
    this.achievements = {}
    this.totalPoints = 0
    this.unlockedAchievements = new Set()

    // Clone achievement templates
    Object.values(ACHIEVEMENTS).forEach((achievement) => {
      this.achievements[achievement.id] = { ...achievement }
    })

    this.saveAchievements()
    debug(LOG_CONTEXT, "Achievements reset to defaults")
  }

  /**
   * Save achievements to storage
   * @returns {Promise<void>}
   */
  async saveAchievements() {
    if (!StorageManager) {
      error(LOG_CONTEXT, "StorageManager not available")
      return
    }

    try {
      await StorageManager.saveToLocalStorage(STORAGE_KEY, this.achievements)
      debug(LOG_CONTEXT, "Achievements saved successfully")
    } catch (err) {
      error(LOG_CONTEXT, "Error saving achievements:", err)
    }
  }

  /**
   * Update achievement progress
   * @param {string} achievementId - Achievement identifier
   * @param {number} progress - Progress to add (defaults to 1)
   * @returns {boolean} - True if progress was updated successfully
   */
  updateProgress(achievementId, progress = 1) {
    const achievement = this.achievements[achievementId]

    if (!achievement) {
      warn(LOG_CONTEXT, `Unknown achievement: ${achievementId}`)
      return false
    }

    // Don't update if already at max progress
    if (achievement.progress >= achievement.maxProgress) {
      return false
    }

    // Calculate new progress, ensuring it doesn't exceed max
    const oldProgress = achievement.progress
    achievement.progress = Math.min(oldProgress + progress, achievement.maxProgress)

    debug(LOG_CONTEXT, `Updated ${achievementId}: ${oldProgress} → ${achievement.progress}/${achievement.maxProgress}`)

    // Check if achievement is now complete
    if (achievement.progress === achievement.maxProgress && !this.unlockedAchievements.has(achievementId)) {
      this.unlockAchievement(achievementId)
    }

    this.saveAchievements()
    return true
  }

  /**
   * Unlock an achievement
   * @param {string} achievementId - Achievement identifier
   * @returns {boolean} - True if achievement was unlocked
   */
  unlockAchievement(achievementId) {
    const achievement = this.achievements[achievementId]

    if (!achievement) {
      warn(LOG_CONTEXT, `Cannot unlock unknown achievement: ${achievementId}`)
      return false
    }

    if (this.unlockedAchievements.has(achievementId)) {
      debug(LOG_CONTEXT, `Achievement already unlocked: ${achievementId}`)
      return false
    }

    // Mark as unlocked and add points
    this.unlockedAchievements.add(achievementId)
    this.totalPoints += achievement.points

    // Ensure progress is at maximum
    achievement.progress = achievement.maxProgress

    // Play achievement unlock sound
    try {
      this.audioManager?.playAchievementSound()
    } catch (err) {
      error(LOG_CONTEXT, "Error playing achievement sound:", err)
    }

    // Create achievement popup
    try {
      this.popupManager?.createAchievementPopup(achievement)
    } catch (err) {
      error(LOG_CONTEXT, "Error creating achievement popup:", err)
    }

    // Log the achievement unlock
    log(LOG_CONTEXT, `Achievement unlocked: ${achievement.name} (+${achievement.points} points)`)

    this.saveAchievements()
    return true
  }

  /**
   * Get achievement progress
   * @param {string} achievementId - Achievement identifier
   * @returns {Object} - Object containing progress and max values
   */
  getAchievementProgress(achievementId) {
    const achievement = this.achievements[achievementId]

    if (!achievement) {
      warn(LOG_CONTEXT, `Unknown achievement: ${achievementId}`)
      return { progress: 0, max: 0, percentage: 0 }
    }

    return {
      progress: achievement.progress,
      max: achievement.maxProgress,
      percentage: achievement.maxProgress > 0 ? Math.floor((achievement.progress / achievement.maxProgress) * 100) : 0,
    }
  }

  /**
   * Check if an achievement is unlocked
   * @param {string} achievementId - Achievement identifier
   * @returns {boolean} - True if achievement is unlocked
   */
  isUnlocked(achievementId) {
    return this.unlockedAchievements.has(achievementId)
  }

  /**
   * Get total achievement points
   * @returns {number} - Total points
   */
  getTotalPoints() {
    return this.totalPoints
  }

  /**
   * Get list of unlocked achievements
   * @returns {Array} - Array of unlocked achievement objects
   */
  getUnlockedAchievements() {
    return Array.from(this.unlockedAchievements).map((id) => this.achievements[id])
  }

  /**
   * Get all achievements
   * @returns {Array} - Array of all achievement objects
   */
  getAllAchievements() {
    return Object.values(this.achievements)
  }

  /**
   * Get achievement by ID
   * @param {string} achievementId - Achievement identifier
   * @returns {Object|null} - Achievement object or null if not found
   */
  getAchievement(achievementId) {
    return this.achievements[achievementId] || null
  }
}

/**
 * Add CSS for achievement display
 */
export function addAchievementStyles() {
  // Check if styles already exist to prevent duplicates
  if (document.getElementById("achievement-styles")) {
    return
  }

  const style = document.createElement("style")
  style.id = "achievement-styles"
  style.textContent = `
    .achievement-display {
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 16px;
      z-index: 10000;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      animation: achievement-slide-in 0.5s ease-out, achievement-fade-out 0.5s ease-in 4.5s forwards;
      pointer-events: none;
    }
    
    @keyframes achievement-slide-in {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes achievement-fade-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    
    .achievement-icon {
      width: 48px;
      height: 48px;
    }
    
    .achievement-icon img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    .achievement-info h3 {
      margin: 0 0 4px 0;
      font-size: 16px;
    }
    
    .achievement-info p {
      margin: 0;
      font-size: 14px;
      opacity: 0.9;
    }
    
    .achievement-points {
      margin-top: 4px;
      font-size: 14px;
      color: #FFD700;
    }
    
    /* Progress bar styles */
    .achievement-progress {
      height: 6px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
      margin-top: 8px;
      overflow: hidden;
    }
    
    .achievement-progress-bar {
      height: 100%;
      background: #4CAF50;
      width: 0%;
      transition: width 0.5s ease-out;
    }
  `
  document.head.appendChild(style)
}

/**
 * Create an achievement UI component for displaying in the game UI
 * @param {Object} achievement - Achievement object
 * @param {boolean} unlocked - Whether the achievement is unlocked
 * @returns {HTMLElement} - Achievement UI component
 */
export function createAchievementElement(achievement, unlocked = false) {
  const element = document.createElement("div")
  element.className = `achievement-item ${unlocked ? "unlocked" : "locked"}`

  const iconSrc = unlocked ? getSprite(achievement.icon) : getSprite("locked_achievement")

  element.innerHTML = `
    <div class="achievement-icon">
      <img src="${iconSrc}" alt="${achievement.name}" />
    </div>
    <div class="achievement-info">
      <h3>${achievement.name}</h3>
      <p>${achievement.description}</p>
      ${unlocked ? `<div class="achievement-points">+${achievement.points} points</div>` : ""}
      ${
        !unlocked && achievement.progress > 0
          ? `
        <div class="achievement-progress">
          <div class="achievement-progress-bar" style="width: ${(achievement.progress / achievement.maxProgress) * 100}%"></div>
        </div>
        <div class="achievement-progress-text">${achievement.progress}/${achievement.maxProgress}</div>
      `
          : ""
      }
    </div>
  `

  return element
}

// Export constants for use in other modules
export { ACHIEVEMENTS }
