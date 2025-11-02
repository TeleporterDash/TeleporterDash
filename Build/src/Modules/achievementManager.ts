import { log, warn, error, debug, setLogLevel } from "./logManager";
import AudioManager from "./audioManager";
import { PopupManager } from "./popupManager";
import { currencyManager } from "./currencyManager";
import {
  StorageManager,
  storageManager as defaultStorageManager,
} from "./storageManager";
import ACHIEVEMENTS from "../JSON/achievements.json";
import "../CSS/achievementManager.css";

const STORAGE_KEY = "achievements";
const LOG_CONTEXT = "achievementManager";

type AchievementDictionary = typeof ACHIEVEMENTS;
export type AchievementId = keyof AchievementDictionary;
export type AchievementData = AchievementDictionary[AchievementId];

type AchievementSnapshot = AchievementData & { id: AchievementId };
type AchievementStore = Record<AchievementId, AchievementSnapshot>;
type SavedAchievementStore = Partial<
  Record<AchievementId, { progress: number }>
>;

export interface AchievementManagerOptions {
  debugMode?: boolean;
  audioManager?: AudioManager;
  popupManager?: PopupManager;
  storageManager?: StorageManager;
}

const asEntries = <T extends Record<string, unknown>>(record: T) =>
  Object.entries(record) as Array<[keyof T, T[keyof T]]>;

const clampProgress = (value: number, max: number): number =>
  Math.max(0, Math.min(value, max));

const formatError = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const resolveIconPath = (icon: string): string =>
  `../assets/Sprites/${icon}.svg`;

export class AchievementManager {
  private achievements: AchievementStore = {} as AchievementStore;
  private totalPoints = 0;
  private readonly unlockedAchievements = new Set<AchievementId>();
  private readonly audioManager?: AudioManager;
  private readonly popupManager?: PopupManager;
  private readonly storageManager: StorageManager;

  constructor({
    debugMode = false,
    audioManager,
    popupManager,
    storageManager = defaultStorageManager,
  }: AchievementManagerOptions = {}) {
    this.audioManager = audioManager;
    this.popupManager = popupManager;
    this.storageManager = storageManager;

    if (debugMode) {
      setLogLevel("debug");
    }

    void this.init();
  }

  get totalAchievementPoints(): number {
    return this.totalPoints;
  }

  async init(): Promise<void> {
    try {
      await this.loadAchievements();
      debug(LOG_CONTEXT, "AchievementManager initialized successfully");
    } catch (err) {
      error(
        LOG_CONTEXT,
        "Failed to initialize AchievementManager:",
        formatError(err)
      );
      this.resetAchievements();
    }
  }

  async loadAchievements(): Promise<void> {
    const saved =
      this.storageManager.getFromLocalStorage<SavedAchievementStore>(
        STORAGE_KEY,
        null
      );

    this.achievements = {} as AchievementStore;
    this.unlockedAchievements.clear();
    this.totalPoints = 0;

    for (const [id, data] of asEntries(ACHIEVEMENTS)) {
      const achievementId = id as AchievementId;
      const base: AchievementSnapshot = { ...data, id: achievementId };
      const progress = saved?.[achievementId]?.progress ?? base.progress;
      const clampedProgress = clampProgress(progress, base.maxProgress);
      const snapshot: AchievementSnapshot = {
        ...base,
        progress: clampedProgress,
      };

      this.achievements[achievementId] = snapshot;

      if (snapshot.progress >= snapshot.maxProgress) {
        this.unlockedAchievements.add(achievementId);
        this.totalPoints += snapshot.points;
      }
    }

    debug(
      LOG_CONTEXT,
      `Loaded ${this.unlockedAchievements.size} unlocked achievements`
    );
  }

  resetAchievements(): void {
    this.achievements = {} as AchievementStore;
    this.unlockedAchievements.clear();
    this.totalPoints = 0;

    for (const [id, data] of asEntries(ACHIEVEMENTS)) {
      const achievementId = id as AchievementId;
      this.achievements[achievementId] = { ...data, id: achievementId };
    }

    void this.saveAchievements();
    debug(LOG_CONTEXT, "Achievements reset to defaults");
  }

  async saveAchievements(): Promise<void> {
    try {
      this.storageManager.saveToLocalStorage(STORAGE_KEY, this.achievements);
      debug(LOG_CONTEXT, "Achievements saved successfully");
    } catch (err) {
      error(LOG_CONTEXT, "Error saving achievements:", formatError(err));
    }
  }

  updateProgress(achievementId: AchievementId, progress = 1): boolean {
    const achievement = this.achievements[achievementId];
    if (!achievement) {
      warn(LOG_CONTEXT, `Unknown achievement: ${achievementId}`);
      return false;
    }

    if (achievement.progress >= achievement.maxProgress) {
      return false;
    }

    const newProgress = clampProgress(
      achievement.progress + progress,
      achievement.maxProgress
    );
    debug(
      LOG_CONTEXT,
      `Updated ${achievementId}: ${achievement.progress} → ${newProgress}/${achievement.maxProgress}`
    );

    achievement.progress = newProgress;

    if (
      newProgress >= achievement.maxProgress &&
      !this.unlockedAchievements.has(achievementId)
    ) {
      this.unlockAchievement(achievementId);
    }

    void this.saveAchievements();
    return true;
  }

  unlockAchievement(achievementId: AchievementId): boolean {
    const achievement = this.achievements[achievementId];
    if (!achievement) {
      warn(LOG_CONTEXT, `Cannot unlock unknown achievement: ${achievementId}`);
      return false;
    }

    if (this.unlockedAchievements.has(achievementId)) {
      debug(LOG_CONTEXT, `Achievement already unlocked: ${achievementId}`);
      return false;
    }

    achievement.progress = achievement.maxProgress;
    this.unlockedAchievements.add(achievementId);
    this.totalPoints += achievement.points;

    currencyManager.addExperience(achievement.points);

    try {
      this.audioManager?.playAchievementSound();
    } catch (err) {
      error(LOG_CONTEXT, "Error playing achievement sound:", formatError(err));
    }

    try {
      this.popupManager?.createAchievementPopup(achievement);
    } catch (err) {
      error(LOG_CONTEXT, "Error creating achievement popup:", formatError(err));
    }

    log(
      LOG_CONTEXT,
      `Achievement unlocked: ${achievement.name} (+${achievement.points} points)`
    );
    void this.saveAchievements();
    return true;
  }

  getAchievementProgress(achievementId: AchievementId): {
    progress: number;
    max: number;
    percentage: number;
  } {
    const achievement = this.achievements[achievementId];
    if (!achievement) {
      warn(LOG_CONTEXT, `Unknown achievement: ${achievementId}`);
      return { progress: 0, max: 0, percentage: 0 };
    }

    const { progress, maxProgress } = achievement;
    const percentage =
      maxProgress > 0 ? Math.floor((progress / maxProgress) * 100) : 0;
    return { progress, max: maxProgress, percentage };
  }

  isUnlocked(achievementId: AchievementId): boolean {
    return this.unlockedAchievements.has(achievementId);
  }

  getUnlockedAchievements(): AchievementSnapshot[] {
    return Array.from(this.unlockedAchievements, (id) => this.achievements[id]);
  }

  getAllAchievements(): AchievementSnapshot[] {
    return Object.values(this.achievements);
  }

  getAchievement(achievementId: AchievementId): AchievementSnapshot | null {
    return this.achievements[achievementId] ?? null;
  }

  getTotalPoints(): number {
    return this.totalPoints;
  }
}

export function createAchievementElement(
  achievement: AchievementSnapshot,
  unlocked = false
): HTMLElement {
  const element = document.createElement("div");
  element.className = `achievement-item ${unlocked ? "unlocked" : "locked"}`;

  const iconSrc = resolveIconPath(achievement.icon);

  element.innerHTML = `
      <div class="achievement-icon">
        <img src="${iconSrc}" alt="${achievement.name}" />
      </div>
      <div class="achievement-info">
        <h3>${achievement.name}</h3>
        <p>${achievement.description}</p>
        ${
          unlocked
            ? `<div class="achievement-points">+${achievement.points} points</div>`
            : ""
        }
        ${
          !unlocked && achievement.progress > 0
            ? `
          <div class="achievement-progress">
            <div class="achievement-progress-bar" style="width: ${
              (achievement.progress / achievement.maxProgress) * 100
            }%"></div>
          </div>
          <div class="achievement-progress-text">${achievement.progress}/${
                achievement.maxProgress
              }</div>
        `
            : ""
        }
      </div>
    `;

  return element;
}
