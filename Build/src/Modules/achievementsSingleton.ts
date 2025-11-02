import { AchievementManager, type AchievementId } from "./achievementManager";
import { storageManager } from "./storageManager";
import { PopupManager } from "./popupManager";
import AudioManager from "./audioManager";
import ACHIEVEMENTS from "../JSON/achievements.json";

type RunData = {
  time: number;
  deaths: number;
  jumps: number;
};

const isAchievementId = (id: string): id is AchievementId => id in ACHIEVEMENTS;
const updateIfValid = (id: string, progress: number): void => {
  if (!isAchievementId(id)) {
    return;
  }
  achievementManager.updateProgress(id, progress);
};

// Create a singleton instance of AchievementManager
const achievementManager = new AchievementManager({
  audioManager: new AudioManager(),
  popupManager: new PopupManager(),
  storageManager,
  debugMode: true,
});

export const AchievementsManager = {
  async checkAchievements(filename: string, runData: RunData): Promise<void> {
    if (filename === "level1" && runData.time < 30) {
      updateIfValid("FIRST_WIN", 1);
    }
    if (runData.deaths === 0) {
      updateIfValid("PERFECT_RUN", 1);
    }
    if (runData.jumps <= 5) {
      updateIfValid("NO_DEATHS", 1);
    }
  },

  // Expose AchievementManager instance methods if needed
  init: () => achievementManager.init(),
  updateProgress: (id: AchievementId, progress = 1) =>
    achievementManager.updateProgress(id, progress),
  unlockAchievement: (id: AchievementId) =>
    achievementManager.unlockAchievement(id),
  getAchievementProgress: (id: AchievementId) =>
    achievementManager.getAchievementProgress(id),
  isUnlocked: (id: AchievementId) => achievementManager.isUnlocked(id),
  getTotalPoints: () => achievementManager.getTotalPoints(),
  getUnlockedAchievements: () => achievementManager.getUnlockedAchievements(),
  getAllAchievements: () => achievementManager.getAllAchievements(),
  getAchievement: (id: AchievementId) => achievementManager.getAchievement(id),
};

export { achievementManager };
