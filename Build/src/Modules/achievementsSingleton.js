import { AchievementManager } from './achievementManager.js';
import { StorageManager } from './storageManager.js';
import { PopupManager } from './popupManager.js';
import AudioManager from './audioManager.js';

// Create a singleton instance of AchievementManager
const achievementManager = new AchievementManager({
  audioManager: new AudioManager(),
  popupManager: new PopupManager(),
  storageManager: new StorageManager(),
  debugMode: true
});

export const AchievementsManager = {
  async checkAchievements(filename, runData) {
    // Example achievement checks based on run data
    if (filename === 'level1' && runData.time < 30) {
      achievementManager.updateProgress('speedster', 1);
    }
    if (runData.deaths === 0) {
      achievementManager.updateProgress('flawless', 1);
    }
    if (runData.jumps <= 5) {
      achievementManager.updateProgress('minimalist', 1);
    }
    // Add more achievement conditions as defined in achievements.json
  },

  // Expose AchievementManager instance methods if needed
  init: () => achievementManager.init(),
  updateProgress: (id, progress) => achievementManager.updateProgress(id, progress),
  unlockAchievement: (id) => achievementManager.unlockAchievement(id),
  getAchievementProgress: (id) => achievementManager.getAchievementProgress(id),
  isUnlocked: (id) => achievementManager.isUnlocked(id),
  getTotalPoints: () => achievementManager.getTotalPoints(),
  getUnlockedAchievements: () => achievementManager.getUnlockedAchievements(),
  getAllAchievements: () => achievementManager.getAllAchievements(),
  getAchievement: (id) => achievementManager.getAchievement(id)
};