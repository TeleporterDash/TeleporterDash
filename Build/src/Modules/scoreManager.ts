import { html, render, type TemplateResult } from "lit-html";
import { storageManager } from "./storageManager";
import { popupManager } from "./popupManager";
import { AchievementsManager } from "./achievementsSingleton";
import { LevelUpManager } from "./levelUpManager";
import { currencyManager } from "./currencyManager";
import { warn, debug } from "./logManager";

const LOG_CONTEXT = "scoreManager";
const SCOREBOARD_CONTAINER_ID = "scoreboard";
const MENU_SCOREBOARD_CONTAINER_ID = "menu-scoreboard";

type SerializedLevelRun = {
  [key: string]: number;
  time: number;
  jumps: number;
  deaths: number;
  timestamp: number;
};

type SerializedLevelScore = {
  [key: string]: string | number | SerializedLevelRun[] | null | boolean;
  levelId: string;
  runs: SerializedLevelRun[];
  bestTime: number;
  bestJumps: number;
  lowestDeaths: number;
};

export interface LevelRun {
  time: number;
  jumps: number;
  deaths: number;
  timestamp: number;
}

export interface LevelScore {
  levelId: string;
  runs: LevelRun[];
  bestTime: number;
  bestJumps: number;
  lowestDeaths: number;
}

export interface LevelStats {
  bestTime: number;
  bestJumps: number;
  lowestDeaths: number;
  totalRuns: number;
}

const INFINITY = Number.POSITIVE_INFINITY;

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

const createDefaultLevelScore = (levelId: string): LevelScore => ({
  levelId,
  runs: [],
  bestTime: INFINITY,
  bestJumps: INFINITY,
  lowestDeaths: INFINITY,
});

const isSerializedLevelRun = (value: unknown): value is SerializedLevelRun => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SerializedLevelRun>;
  return (
    typeof candidate.time === "number" &&
    typeof candidate.jumps === "number" &&
    typeof candidate.deaths === "number" &&
    typeof candidate.timestamp === "number"
  );
};

const normalizeRuns = (runs: unknown): LevelRun[] => {
  if (!Array.isArray(runs)) return [];
  return runs.filter(isSerializedLevelRun).map((run) => ({
    time: run.time,
    jumps: run.jumps,
    deaths: run.deaths,
    timestamp: run.timestamp,
  }));
};

const normalizeScore = (raw: unknown): LevelScore | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<SerializedLevelScore>;
  if (typeof candidate.levelId !== "string" || !candidate.levelId) return null;

  const runs = normalizeRuns(candidate.runs);

  return {
    levelId: candidate.levelId,
    runs,
    bestTime: isFinitePositive(candidate.bestTime ?? INFINITY)
      ? candidate.bestTime!
      : INFINITY,
    bestJumps: isFinitePositive(candidate.bestJumps ?? INFINITY)
      ? candidate.bestJumps!
      : INFINITY,
    lowestDeaths: isFinitePositive(candidate.lowestDeaths ?? INFINITY)
      ? candidate.lowestDeaths!
      : INFINITY,
  };
};

const formatTimeValue = (time: number): string =>
  time === INFINITY ? "N/A" : `${time.toFixed(1)}s`;

const serializeLevelScore = (score: LevelScore): SerializedLevelScore => ({
  levelId: score.levelId,
  runs: score.runs.map((run) => ({
    time: run.time,
    jumps: run.jumps,
    deaths: run.deaths,
    timestamp: run.timestamp,
  })),
  bestTime: score.bestTime,
  bestJumps: score.bestJumps,
  lowestDeaths: score.lowestDeaths,
});

class ScoreManagerService {
  private readonly scores = new Map<string, LevelScore>();

  get allScores(): ReadonlyMap<string, LevelScore> {
    return this.scores;
  }

  async initialize(): Promise<void> {
    try {
      const persisted =
        await storageManager.getAllFromStore<SerializedLevelScore>("scores");
      for (const entry of persisted) {
        const normalized = normalizeScore(entry);
        if (normalized) {
          this.scores.set(normalized.levelId, normalized);
        }
      }
      debug(
        LOG_CONTEXT,
        `Initialized with ${this.scores.size} score records from storage`
      );
    } catch (err) {
      warn(LOG_CONTEXT, "Failed to initialize scores:", err);
    }
  }

  async addRun(
    filename: string,
    time: number,
    jumps: number,
    deaths = 0
  ): Promise<void> {
    const levelScore =
      this.scores.get(filename) ?? createDefaultLevelScore(filename);

    const previousBestTime = levelScore.bestTime;
    const previousBestJumps = levelScore.bestJumps;
    const previousLowestDeaths = levelScore.lowestDeaths;

    const runData: LevelRun = { time, jumps, deaths, timestamp: Date.now() };
    levelScore.runs.unshift(runData);

    levelScore.bestTime = Math.min(levelScore.bestTime, time);
    levelScore.bestJumps = Math.min(levelScore.bestJumps, jumps);
    levelScore.lowestDeaths = Math.min(levelScore.lowestDeaths, deaths);

    this.scores.set(filename, levelScore);
    await storageManager.saveToStore(
      "scores",
      filename,
      serializeLevelScore(levelScore)
    );

    this.maybeShowPopup(
      filename,
      "best-time",
      time < previousBestTime || previousBestTime === INFINITY,
      html`<div>New Best Time: ${formatTimeValue(time)}!</div>`
    );

    this.maybeShowPopup(
      filename,
      "best-jumps",
      jumps < previousBestJumps || previousBestJumps === INFINITY,
      html`<div>New Best Jumps: ${jumps}!</div>`
    );

    this.maybeShowPopup(
      filename,
      "lowest-deaths",
      deaths < previousLowestDeaths || previousLowestDeaths === INFINITY,
      html`<div>New Lowest Deaths: ${deaths}!</div>`
    );

    this.maybeShowPopup(
      filename,
      "perfect-run",
      deaths === 0,
      html`<div>Perfect Run! No deaths!</div>`
    );

    const baseExperience = Math.max(
      0,
      100 - time + 10 * (10 - jumps) - 20 * deaths
    );
    currencyManager.addExperience(baseExperience);

    await AchievementsManager.checkAchievements(filename, runData);
    LevelUpManager.checkLevelUp();
  }

  getLevelStats(filename: string): LevelStats | null {
    const levelScore = this.scores.get(filename);
    if (!levelScore) return null;

    return {
      bestTime: levelScore.bestTime,
      bestJumps: levelScore.bestJumps,
      lowestDeaths: levelScore.lowestDeaths,
      totalRuns: levelScore.runs.length,
    };
  }

  updateScoreboardUI(filename: string): void {
    const stats = this.getLevelStats(filename);
    if (!stats) return;

    const container = this.ensureContainer(SCOREBOARD_CONTAINER_ID);
    if (!container) return;

    render(this.scoreboardTemplate(stats, filename), container);
  }

  async updateMenuScoreboardUI(): Promise<void> {
    const entries: Array<[string, LevelStats]> = [];
    for (const [levelId] of this.scores) {
      const stats = this.getLevelStats(levelId);
      if (stats) {
        entries.push([levelId, stats]);
      }
    }

    if (entries.length === 0) return;

    const container = this.ensureContainer(MENU_SCOREBOARD_CONTAINER_ID);
    if (!container) return;

    render(this.menuScoreboardTemplate(entries), container);
  }

  private maybeShowPopup(
    filename: string,
    key: string,
    shouldShow: boolean,
    content: TemplateResult
  ): void {
    if (!shouldShow) return;

    const popupId = `${key}-${filename}`;
    const element = popupManager.createRegularPopup(popupId, content);
    if (!element) return;

    popupManager.showPopup(popupId);
    setTimeout(() => popupManager.hidePopup(popupId), 3_000);
  }

  private ensureContainer(id: string): HTMLDivElement | null {
    if (typeof document === "undefined" || !document.body) {
      warn(LOG_CONTEXT, "Cannot render scoreboard: document is unavailable");
      return null;
    }

    const existing = document.getElementById(id) as HTMLDivElement | null;
    if (existing) return existing;

    const container = document.createElement("div");
    container.id = id;
    document.body.appendChild(container);
    return container;
  }

  private scoreboardTemplate(
    stats: LevelStats,
    filename: string
  ): TemplateResult {
    return html`
      <div
        class="scoreboard"
        style="position: fixed; right: 20px; top: 50%; transform: translateY(-50%); background: rgba(0, 0, 0, 0.8); color: white; padding: 20px; border-radius: 15px;"
      >
        <h3>${filename} Stats</h3>
        <div>Best Time: <span>${formatTimeValue(stats.bestTime)}</span></div>
        <div>
          Best Jumps:
          <span>${stats.bestJumps === INFINITY ? "N/A" : stats.bestJumps}</span>
        </div>
        <div>
          Lowest Deaths:
          <span
            >${stats.lowestDeaths === INFINITY
              ? "N/A"
              : stats.lowestDeaths}</span
          >
        </div>
        <div>Total Runs: <span>${stats.totalRuns}</span></div>
      </div>
    `;
  }

  private menuScoreboardTemplate(
    entries: Array<[string, LevelStats]>
  ): TemplateResult {
    const sorted = entries.slice().sort(([a], [b]) => {
      const numericA = parseInt(a.replace(/\D+/g, ""), 10);
      const numericB = parseInt(b.replace(/\D+/g, ""), 10);
      if (Number.isNaN(numericA) || Number.isNaN(numericB)) {
        return a.localeCompare(b);
      }
      return numericA - numericB;
    });

    return html`
      <div class="menu-scoreboard">
        <h2>All Levels Stats</h2>
        ${sorted.map(
          ([filename, stats]) => html`
            <div>
              <h3>${filename}</h3>
              <p>Best Time: ${formatTimeValue(stats.bestTime)}</p>
              <p>
                Best Jumps:
                ${stats.bestJumps === INFINITY ? "N/A" : stats.bestJumps}
              </p>
              <p>
                Lowest Deaths:
                ${stats.lowestDeaths === INFINITY ? "N/A" : stats.lowestDeaths}
              </p>
              <p>Total Runs: ${stats.totalRuns}</p>
            </div>
          `
        )}
      </div>
    `;
  }
}

const scoreManagerInstance = new ScoreManagerService();

export const scoreManager = scoreManagerInstance;
export const ScoreManager = scoreManagerInstance;
