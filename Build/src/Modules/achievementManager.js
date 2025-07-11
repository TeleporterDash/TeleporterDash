import { log, warn, error, debug, setLogLevel } from "./logManager.js";
import { getSprite } from "./spriteManager.js";
import AudioManager from "./audioManager.js";
import { PopupManager } from "./popupManager.js";
import { currencyManager } from "./currencyManager.js"; // Import singleton
import ACHIEVEMENTS from '../JSON/achievements.json';
import '../CSS/achievementManager.css';

const STORAGE_KEY = "achievements";
const LOG_CONTEXT = "achievementManager";

export class AchievementManager {
  constructor(options = {}) {
    this.achievements = {};
    this.totalPoints = 0;
    this.unlockedAchievements = new Set();
    this.audioManager = options.audioManager || new AudioManager();
    this.popupManager = options.popupManager || new PopupManager();
    this.storageManager = options.storageManager;

    if (options.debugMode) {
      setLogLevel("debug");
    }

    this.init();
  }

  async init() {
    try {
      await this.loadAchievements();
      debug(LOG_CONTEXT, "AchievementManager initialized successfully");
    } catch (err) {
      error(LOG_CONTEXT, "Failed to initialize AchievementManager:", err);
      this.resetAchievements();
    }
  }

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

    // Award experience points when achievement is unlocked
    currencyManager.addExperience(achievement.points);

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

  isUnlocked(achievementId) {
    return this.unlockedAchievements.has(achievementId);
  }

  getTotalPoints() {
    return this.totalPoints;
  }

  getUnlockedAchievements() {
    return Array.from(this.unlockedAchievements).map((id) => this.achievements[id]);
  }

  getAllAchievements() {
    return Object.values(this.achievements);
  }

  getAchievement(achievementId) {
    return this.achievements[achievementId] || null;
  }
}

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