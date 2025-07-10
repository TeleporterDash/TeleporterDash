// Modules/achievementManager.js
import { log, warn, error, debug, setLogLevel } from "./logManager.js";
import { getSprite } from "./spriteManager.js";
import AudioManager from "./audioManager.js";
import { PopupManager } from "./popupManager.js"; // Import PopupManager class
import ACHIEVEMENTS from '../JSON/achievements.json'; // Import achievements from JSON
import '../CSS/achievementManager.css'; // Import styles

// Constants
const STORAGE_KEY = "achievements";
const LOG_CONTEXT = "achievementManager";

/**
 * Achievement manager class that handles tracking, unlocking, and storing achievements
 */
export class AchievementManager {
  /**
   * Create a new AchievementManager instance
   * @param {Object} options - Configuration options
   * @param {AudioManager} options.audioManager - Audio manager instance
   * @param {PopupManager} options.popupManager - Popup manager instance
   * @param {StorageManager} options.storageManager - Storage manager instance
   * @param {boolean} options.debugMode - Enable debug mode
   */
  constructor(options = {}) {
    this.achievements = {};
    this.totalPoints = 0;
    this.unlockedAchievements = new Set();

    // Dependencies injected through constructor for better testability
    this.audioManager = options.audioManager || new AudioManager();
    this.popupManager = options.popupManager || new PopupManager(); // Default to new instance if not provided
    this.storageManager = options.storageManager;

    // Set log level if debug mode is enabled
    if (options.debugMode) {
      setLogLevel("debug");
    }

    // Initialize achievements
    this.init();
  }

  /**
   * Initialize the achievement manager
   */
  async init() {
    try {
      await this.loadAchievements();
      debug(LOG_CONTEXT, "AchievementManager initialized successfully");
    } catch (err) {
      error(LOG_CONTEXT, "Failed to initialize AchievementManager:", err);
      this.resetAchievements();
    }
  }

  /**
   * Load achievements from storage
   * @returns {Promise<void>}
   */
  async loadAchievements() {
    if (!this.storageManager) {
      error(LOG_CONTEXT, "StorageManager not available");
      this.resetAchievements();
      return;
    }

    try {
      const saved = await this.storageManager.getFromLocalStorage(STORAGE_KEY);

      if (saved) {
        this.achievements = {};
        this.totalPoints = 0;
        this.unlockedAchievements = new Set();

        if (typeof ACHIEVEMENTS === "undefined") {
          throw new Error("ACHIEVEMENTS data is not defined");
        }

        Object.keys(ACHIEVEMENTS).forEach((id) => {
          this.achievements[id] = { ...ACHIEVEMENTS[id] };

          if (saved[id]) {
            const savedProgress = saved[id].progress;
            if (typeof savedProgress === "number") {
              this.achievements[id].progress = Math.max(0, Math.min(savedProgress, this.achievements[id].maxProgress));

              if (this.achievements[id].progress >= this.achievements[id].maxProgress) {
                this.unlockedAchievements.add(id);
                this.totalPoints += this.achievements[id].points;
              }
            }
          }
        });

        debug(LOG_CONTEXT, `Loaded ${this.unlockedAchievements.size} unlocked achievements`);
      } else {
        debug(LOG_CONTEXT, "No saved achievements found, initializing defaults");
        this.resetAchievements();
      }
    } catch (err) {
      warn(LOG_CONTEXT, "Error loading achievements:", err);
      this.resetAchievements();
    }
  }

  /**
   * Reset achievements to default values
   */
  resetAchievements() {
    this.achievements = {};
    this.totalPoints = 0;
    this.unlockedAchievements = new Set();

    if (typeof ACHIEVEMENTS === "undefined") {
      error(LOG_CONTEXT, "ACHIEVEMENTS data is not defined, cannot reset");
      return;
    }

    Object.values(ACHIEVEMENTS).forEach((achievement) => {
      this.achievements[achievement.id] = { ...achievement };
    });

    this.saveAchievements();
    debug(LOG_CONTEXT, "Achievements reset to defaults");
  }

  /**
   * Save achievements to storage
   * @returns {Promise<void>}
   */
  async saveAchievements() {
    if (!this.storageManager) {
      error(LOG_CONTEXT, "StorageManager not available");
      return;
    }

    try {
      await this.storageManager.saveToLocalStorage(STORAGE_KEY, this.achievements);
      debug(LOG_CONTEXT, "Achievements saved successfully");
    } catch (err) {
      error(LOG_CONTEXT, "Error saving achievements:", err);
    }
  }

  /**
   * Update achievement progress
   * @param {string} achievementId - Achievement identifier
   * @param {number} progress - Progress to add (defaults to 1)
   * @returns {boolean} - True if progress was updated successfully
   */
  updateProgress(achievementId, progress = 1) {
    const achievement = this.achievements[achievementId];

    if (!achievement) {
      warn(LOG_CONTEXT, `Unknown achievement: ${achievementId}`);
      return false;
    }

    if (achievement.progress >= achievement.maxProgress) {
      return false;
    }

    const oldProgress = achievement.progress;
    achievement.progress = Math.min(oldProgress + progress, achievement.maxProgress);

    debug(LOG_CONTEXT, `Updated ${achievementId}: ${oldProgress} → ${achievement.progress}/${achievement.maxProgress}`);

    if (achievement.progress === achievement.maxProgress && !this.unlockedAchievements.has(achievementId)) {
      this.unlockAchievement(achievementId);
    }

    this.saveAchievements();
    return true;
  }

  /**
   * Unlock an achievement
   * @param {string} achievementId - Achievement identifier
   * @returns {boolean} - True if achievement was unlocked
   */
  unlockAchievement(achievementId) {
    const achievement = this.achievements[achievementId];

    if (!achievement) {
      warn(LOG_CONTEXT, `Cannot unlock unknown achievement: ${achievementId}`);
      return false;
    }

    if (this.unlockedAchievements.has(achievementId)) {
      debug(LOG_CONTEXT, `Achievement already unlocked: ${achievementId}`);
      return false;
    }

    this.unlockedAchievements.add(achievementId);
    this.totalPoints += achievement.points;
    achievement.progress = achievement.maxProgress;

    try {
      this.audioManager?.playAchievementSound();
    } catch (err) {
      error(LOG_CONTEXT, "Error playing achievement sound:", err);
    }

    try {
      this.popupManager?.createAchievementPopup(achievement);
    } catch (err) {
      error(LOG_CONTEXT, "Error creating achievement popup:", err);
    }

    log(LOG_CONTEXT, `Achievement unlocked: ${achievement.name} (+${achievement.points} points)`);

    this.saveAchievements();
    return true;
  }

  /**
   * Get achievement progress
   * @param {string} achievementId - Achievement identifier
   * @returns {Object} - Object containing progress and max values
   */
  getAchievementProgress(achievementId) {
    const achievement = this.achievements[achievementId];

    if (!achievement) {
      warn(LOG_CONTEXT, `Unknown achievement: ${achievementId}`);
      return { progress: 0, max: 0, percentage: 0 };
    }

    return {
      progress: achievement.progress,
      max: achievement.maxProgress,
      percentage: achievement.maxProgress > 0 ? Math.floor((achievement.progress / achievement.maxProgress) * 100) : 0,
    };
  }

  /**
   * Check if an achievement is unlocked
   * @param {string} achievementId - Achievement identifier
   * @returns {boolean} - True if achievement is unlocked
   */
  isUnlocked(achievementId) {
    return this.unlockedAchievements.has(achievementId);
  }

  /**
   * Get total achievement points
   * @returns {number} - Total points
   */
  getTotalPoints() {
    return this.totalPoints;
  }

  /**
   * Get list of unlocked achievements
   * @returns {Array} - Array of unlocked achievement objects
   */
  getUnlockedAchievements() {
    return Array.from(this.unlockedAchievements).map((id) => this.achievements[id]);
  }

  /**
   * Get all achievements
   * @returns {Array} - Array of all achievement objects
   */
  getAllAchievements() {
    return Object.values(this.achievements);
  }

  /**
   * Get achievement by ID
   * @param {string} achievementId - Achievement identifier
   * @returns {Object|null} - Achievement object or null if not found
   */
  getAchievement(achievementId) {
    return this.achievements[achievementId] || null;
  }
}

/**
 * Create an achievement UI component for displaying in the game UI
 * @param {Object} achievement - Achievement object
 * @param {boolean} unlocked - Whether the achievement is unlocked
 * @returns {HTMLElement} - Achievement UI component
 */
export function createAchievementElement(achievement, unlocked = false) {
  const element = document.createElement("div");
  element.className = `achievement-item ${unlocked ? "unlocked" : "locked"}`;

  const iconSrc = unlocked ? getSprite(achievement.icon) : getSprite("locked_achievement");

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
  `;

  return element;
}