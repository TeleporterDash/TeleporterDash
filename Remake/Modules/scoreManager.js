import { html, render } from 'lit-html';
import { StorageManager } from './storageManager.js';
import { popupManager } from './popupManager.js';
import { AchievementsManager } from './achievements.js'; // Assumed singleton instance
import { LevelUpManager } from './level-up.js';     // Assumed singleton instance
import { warn, debug } from './logManager.js';

// Singleton instance of ScoreManager
export const ScoreManager = {
  // In-memory cache of scores (levelId -> { runs, bestTime, bestJumps, lowestDeaths })
  scores: new Map(),

  /**
   * Initialize the ScoreManager by loading scores from StorageManager.
   */
  async initialize() {
    try {
      const allLevelScores = await StorageManager.getAllFromStore('scores');
      allLevelScores.forEach(levelScore => {
        this.scores.set(levelScore.levelId, levelScore);
      });
      debug('scoreManager', 'Initialized with scores from storage');
    } catch (err) {
      warn('scoreManager', 'Failed to initialize scores:', err);
    }
  },

  /**
   * Add a new run for a level, update stats, and delegate notifications/achievements.
   * @param {string} filename - Level identifier
   * @param {number} time - Time taken in seconds
   * @param {number} jumps - Number of jumps
   * @param {number} deaths - Number of deaths (default 0)
   */
  async addRun(filename, time, jumps, deaths = 0) {
    // Get or initialize level data
    let levelData = this.scores.get(filename) || {
      levelId: filename,
      runs: [],
      bestTime: Number.POSITIVE_INFINITY,
      bestJumps: Number.POSITIVE_INFINITY,
      lowestDeaths: Number.POSITIVE_INFINITY
    };

    // Store previous bests for comparison
    const previousBestTime = levelData.bestTime;
    const previousBestJumps = levelData.bestJumps;
    const previousLowestDeaths = levelData.lowestDeaths;

    // Add new run
    const runData = { time, jumps, deaths, timestamp: Date.now() };
    levelData.runs.unshift(runData);

    // Update best stats
    levelData.bestTime = Math.min(levelData.bestTime, time);
    levelData.bestJumps = Math.min(levelData.bestJumps, jumps);
    levelData.lowestDeaths = Math.min(levelData.lowestDeaths, deaths);

    // Update in-memory cache
    this.scores.set(filename, levelData);

    // Persist to storage
    await StorageManager.saveToStore('scores', filename, levelData);

    // Show popups for improvements
    if (time < previousBestTime || previousBestTime === Number.POSITIVE_INFINITY) {
      popupManager.createRegularPopup(
        `best-time-${filename}`,
        html`<div>New Best Time: ${this.formatTime(time)}!</div>`
      );
      popupManager.showPopup(`best-time-${filename}`);
      setTimeout(() => popupManager.hidePopup(`best-time-${filename}`), 3000);
    }
    if (jumps < previousBestJumps || previousBestJumps === Number.POSITIVE_INFINITY) {
      popupManager.createRegularPopup(
        `best-jumps-${filename}`,
        html`<div>New Best Jumps: ${jumps}!</div>`
      );
      popupManager.showPopup(`best-jumps-${filename}`);
      setTimeout(() => popupManager.hidePopup(`best-jumps-${filename}`), 3000);
    }
    if (deaths < previousLowestDeaths || previousLowestDeaths === Number.POSITIVE_INFINITY) {
      popupManager.createRegularPopup(
        `lowest-deaths-${filename}`,
        html`<div>New Lowest Deaths: ${deaths}!</div>`
      );
      popupManager.showPopup(`lowest-deaths-${filename}`);
      setTimeout(() => popupManager.hidePopup(`lowest-deaths-${filename}`), 3000);
    }
    if (deaths === 0) {
      popupManager.createRegularPopup(
        `perfect-run-${filename}`,
        html`<div>Perfect Run! No deaths!</div>`
      );
      popupManager.showPopup(`perfect-run-${filename}`);
      setTimeout(() => popupManager.hidePopup(`perfect-run-${filename}`), 3000);
    }

    // Delegate to external managers
    await AchievementsManager.checkAchievements(filename, runData);
    await LevelUpManager.checkLevelUp(filename, levelData);
  },

  /**
   * Get stats for a specific level.
   * @param {string} filename - Level identifier
   * @returns {Object|null} - Stats object or null if no data
   */
  getLevelStats(filename) {
    const levelData = this.scores.get(filename);
    if (!levelData) return null;
    return {
      bestTime: levelData.bestTime,
      bestJumps: levelData.bestJumps,
      lowestDeaths: levelData.lowestDeaths,
      totalRuns: levelData.runs.length
    };
  },

  /**
   * Update the scoreboard UI for a specific level.
   * @param {string} filename - Level identifier
   */
  updateScoreboardUI(filename) {
    const stats = this.getLevelStats(filename);
    if (!stats) return;
    const container = document.getElementById('scoreboard') || this.createContainer('scoreboard');
    render(this.scoreboardTemplate(stats, filename), container);
  },

  /**
   * Create a container element if it doesn't exist.
   * @param {string} id - Container ID
   * @returns {HTMLElement} - Container element
   */
  createContainer(id) {
    const container = document.createElement('div');
    container.id = id;
    document.body.appendChild(container);
    return container;
  },

  /**
   * Template for rendering the scoreboard.
   * @param {Object} stats - Level stats
   * @param {string} filename - Level identifier
   * @returns {TemplateResult} - lit-html template
   */
  scoreboardTemplate(stats, filename) {
    return html`
      <div class="scoreboard" style="position: fixed; right: 20px; top: 50%; transform: translateY(-50%); background: rgba(0, 0, 0, 0.8); color: white; padding: 20px; border-radius: 15px;">
        <h3>${filename} Stats</h3>
        <div>Best Time: <span>${this.formatTime(stats.bestTime)}</span></div>
        <div>Best Jumps: <span>${stats.bestJumps === Number.POSITIVE_INFINITY ? 'N/A' : stats.bestJumps}</span></div>
        <div>Lowest Deaths: <span>${stats.lowestDeaths === Number.POSITIVE_INFINITY ? 'N/A' : stats.lowestDeaths}</span></div>
        <div>Total Runs: <span>${stats.totalRuns}</span></div>
      </div>
    `;
  },

  /**
   * Format time for display.
   * @param {number} time - Time in seconds
   * @returns {string} - Formatted time string
   */
  formatTime(time) {
    return time === Number.POSITIVE_INFINITY ? 'N/A' : `${time.toFixed(1)}s`;
  },

  /**
   * Update the menu scoreboard UI showing stats for all levels.
   */
  async updateMenuScoreboardUI() {
    const allStats = {};
    for (const [filename, data] of this.scores) {
      allStats[filename] = this.getLevelStats(filename);
    }
    const container = document.getElementById('menu-scoreboard') || this.createContainer('menu-scoreboard');
    render(this.menuScoreboardTemplate(allStats), container);
  },

  /**
   * Template for rendering the menu scoreboard.
   * @param {Object} allStats - Stats for all levels
   * @returns {TemplateResult} - lit-html template
   */
  menuScoreboardTemplate(allStats) {
    const sortedStats = Object.entries(allStats).sort(([a], [b]) => {
      const numA = parseInt(a.replace('level', '')) || 0;
      const numB = parseInt(b.replace('level', '')) || 0;
      return numA - numB;
    });
    return html`
      <div class="menu-scoreboard">
        <h2>All Levels Stats</h2>
        ${sortedStats.map(([filename, stats]) => html`
          <div>
            <h3>${filename}</h3>
            <p>Best Time: ${this.formatTime(stats.bestTime)}</p>
            <p>Best Jumps: ${stats.bestJumps === Number.POSITIVE_INFINITY ? 'N/A' : stats.bestJumps}</p>
          </div>
        `)}
      </div>
    `;
  }
};