import { html, render } from 'lit-html';
import { StorageManager } from './storageManager.js';
import { popupManager } from './popupManager.js';
import { AchievementsManager } from './achievementsSingleton.js';
import { LevelUpManager } from './levelUpManager.js';
import { currencyManager } from './currencyManager.js'; // Import singleton
import { warn, debug } from './logManager.js';

// Singleton instance of ScoreManager
export const ScoreManager = {
  scores: new Map(),

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

  async addRun(filename, time, jumps, deaths = 0) {
    let levelData = this.scores.get(filename) || {
      levelId: filename,
      runs: [],
      bestTime: Number.POSITIVE_INFINITY,
      bestJumps: Number.POSITIVE_INFINITY,
      lowestDeaths: Number.POSITIVE_INFINITY
    };

    const previousBestTime = levelData.bestTime;
    const previousBestJumps = levelData.bestJumps;
    const previousLowestDeaths = levelData.lowestDeaths;

    const runData = { time, jumps, deaths, timestamp: Date.now() };
    levelData.runs.unshift(runData);

    levelData.bestTime = Math.min(levelData.bestTime, time);
    levelData.bestJumps = Math.min(levelData.bestJumps, jumps);
    levelData.lowestDeaths = Math.min(levelData.lowestDeaths, deaths);

    this.scores.set(filename, levelData);
    await StorageManager.saveToStore('scores', filename, levelData);

    if (time < previousBestTime || previousBestTime === Number.POSITIVE_INFINITY) {
      popupManager.createRegularPopup(
        ` over-best-time-${filename}`,
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

    // Calculate and add experience based on performance
    const baseExperience = Math.max(0, 100 - time + 10 * (10 - jumps) - 20 * deaths);
    currencyManager.addExperience(baseExperience);

    // Check achievements (may add more experience)
    await AchievementsManager.checkAchievements(filename, runData);

    // Check for level up based on total experience
    await LevelUpManager.checkLevelUp();
  },

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

  updateScoreboardUI(filename) {
    const stats = this.getLevelStats(filename);
    if (!stats) return;
    const container = document.getElementById('scoreboard') || this.createContainer('scoreboard');
    render(this.scoreboardTemplate(stats, filename), container);
  },

  createContainer(id) {
    const container = document.createElement('div');
    container.id = id;
    document.body.appendChild(container);
    return container;
  },

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

  formatTime(time) {
    return time === Number.POSITIVE_INFINITY ? 'N/A' : `${time.toFixed(1)}s`;
  },

  async updateMenuScoreboardUI() {
    const allStats = {};
    for (const [filename, data] of this.scores) {
      allStats[filename] = this.getLevelStats(filename);
    }
    const container = document.getElementById('menu-scoreboard') || this.createContainer('menu-scoreboard');
    render(this.menuScoreboardTemplate(allStats), container);
  },

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