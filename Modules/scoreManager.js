// Score Manager for Teleporter Dash
// Updated to use StorageManager for data operations
import { warn, error, debug } from "./logManager.js"
import { StorageManager } from "./storageManager.js"

const ScoreManager = {
  // Constants for storage
  SCORES_KEY: "levelScores",

  // Default scores structure using Map
  scores: {
    levels: new Map(),
  },
  // Initialize using StorageManager
  async initDB() {
    try {
      debug("scoreManager", "Initializing StorageManager")
      if (!StorageManager) {
        throw new Error("StorageManager is not available")
      }
      await StorageManager.initialize()
      debug("scoreManager", "StorageManager initialized successfully")
      return true
    } catch (err) {
      error("scoreManager", "Error initializing StorageManager:", err)
      return false
    }
  },

  // Initialize scores from StorageManager or fallback to memory
  async initialize() {
    try {
      debug("scoreManager", "Initializing scores...")
      await this.initDB()

      try {
        debug("scoreManager", "Loading scores from StorageManager")
        if (!StorageManager) {
          throw new Error("StorageManager is not available")
        }
        const allScores = await StorageManager.getAllScores()
        this.scores.levels = new Map()

        // Convert the array of scores to a Map
        if (Array.isArray(allScores)) {
          allScores.forEach((scoreData) => {
            this.scores.levels.set(scoreData.levelId, scoreData)
          })
          debug("scoreManager", "Scores loaded successfully from StorageManager")
        } else {
          throw new Error("Invalid scores data format")
        }
      } catch (err) {
        error("scoreManager", "Error loading scores from StorageManager:", err)
        this.scores = { levels: new Map() }
        debug("scoreManager", "Using memory storage fallback for scores")
      }
    } catch (err) {
      error("scoreManager", "Error initializing scores:", err)
      this.scores = { levels: new Map() }
    }
  },

  // Save scores using StorageManager with memory fallback
  async save() {
    try {
      debug("scoreManager", "Saving scores to StorageManager")
      // First, make sure scores are saved in memory
      if (!this.scores.levels) {
        this.scores.levels = new Map()
      }

      // Check if StorageManager is available
      if (!StorageManager) {
        warn("scoreManager", "StorageManager not available, using memory storage only")
        return
      }

      // Then save each level's scores to StorageManager
      for (const [levelId, scoreData] of this.scores.levels) {
        try {
          // This will create a new entry or update an existing one
          try {
            await StorageManager.saveLevel({
              id: levelId,
              scoreData: scoreData,
            })
            debug("scoreManager", `Saved scores for level ${levelId} using StorageManager`)
          } catch (err) {
            warn("scoreManager", `Error saving scores for level ${levelId}:`, err)
          }
        } catch (err) {
          error("scoreManager", `Error saving scores for level ${levelId}:`, err)
        }
      }
    } catch (err) {
      error("scoreManager", "Error in score save function:", err)
    }
  },

  // Add a new run for a level
  async addRun(filename, time, jumps, deaths = 0) {
    const now = new Date()

    // Create level data if it doesn't exist
    if (!this.scores.levels.has(filename)) {
      this.scores.levels.set(filename, {
        bestTime: Number.POSITIVE_INFINITY,
        bestJumps: Number.POSITIVE_INFINITY,
        totalRuns: 0,
        totalJumps: 0,
        totalDeaths: 0,
        perfectRuns: 0, // No deaths
        runs: [],
      })
    }

    const levelData = this.scores.levels.get(filename)

    // Add the new run
    const newRun = {
      time,
      jumps,
      deaths,
      date: now.toISOString(),
      perfect: deaths === 0,
    }

    // Store all runs ever (all-time)
    if (!Array.isArray(levelData.runs)) levelData.runs = []
    levelData.runs.unshift(newRun) // Add to beginning

    // Recalculate ALL stats from all runs (all-time)
    const all = levelData.runs
    levelData.totalRuns = all.length
    levelData.totalJumps = all.reduce((sum, r) => sum + (r.jumps || 0), 0)
    levelData.totalDeaths = all.reduce((sum, r) => sum + (r.deaths || 0), 0)
    levelData.bestTime = all.length ? Math.min(...all.map((r) => r.time)) : Number.POSITIVE_INFINITY
    levelData.bestJumps = all.length ? Math.min(...all.map((r) => r.jumps)) : Number.POSITIVE_INFINITY
    levelData.lowestDeaths = all.length ? Math.min(...all.map((r) => r.deaths)) : Number.POSITIVE_INFINITY
    levelData.perfectRuns = all.filter((r) => r.deaths === 0).length

    // Save scores using both memory map and StorageManager
    await this.save()

    // Also use direct StorageManager score saving for redundancy
    try {
      try {
        if (StorageManager.db) {
          await StorageManager.saveScore(filename, time, jumps, deaths)
        } else {
          warn("scoreManager", "StorageManager not available for direct score saving")
        }
      } catch (err) {
        error("scoreManager", `Error saving score via StorageManager for level ${filename}:`, err)
      }
    } catch (err) {
      error("scoreManager", `Error saving score via StorageManager for level ${filename}:`, err)
    }
    this.updateScoreboardUI(filename)
  },

  /**
   * Get stats for a specific level by filename/id
   * @param {string} levelId - The level ID to get stats for
   * @returns {Object|null} The level stats or null if not found
   */
  getLevelStats(levelId) {
    debug("scoreManager", `Getting stats for level ${levelId}`)
    // First try to get from the cached scores
    if (this.scores.levels.has(levelId)) {
      const stats = this.scores.levels.get(levelId)
      if (!Array.isArray(stats.runs)) {
        stats.runs = []
      }
      return stats
    }

    // If not in cache, try to get from localStorage
    const scoresData = localStorage.getItem(this.SCORES_KEY)
    if (scoresData) {
      try {
        const parsedScores = JSON.parse(scoresData)
        if (parsedScores.levels && parsedScores.levels[levelId]) {
          const stats = parsedScores.levels[levelId]
          // Upgrade: ensure allRuns is present and includes all runs ever
          if (!Array.isArray(stats.allRuns)) {
            stats.allRuns = Array.isArray(stats.runs) ? [...stats.runs] : []
          }
          this.scores.levels.set(levelId, stats)
          return stats
        }
      } catch (err) {
        error("scoreManager", "Error parsing scores data:", err)
      }
    }

    // Return default stats object if nothing was found
    return {
      bestTime: Number.POSITIVE_INFINITY,
      bestJumps: Number.POSITIVE_INFINITY,
      lowestDeaths: Number.POSITIVE_INFINITY,
      perfectRuns: 0,
      totalDeaths: 0,
      totalRuns: 0,
      runs: [],
    }
  },

  /**
   * Update the UI scoreboard with level stats
   * @param {string} levelId - The level ID to update the scoreboard for
   */
  updateScoreboardUI(filename) {
    debug("scoreManager", `Updating scoreboard UI for level ${filename}`)
    let scoreboard = document.getElementById("scoreboard")
    if (!scoreboard) {
      scoreboard = this.createScoreboardUI()
    }

    const stats = this.getLevelStats(filename) || {}
    // Defensive fallback for all stats
    const bestTime =
      typeof stats.bestTime === "number" && !isNaN(stats.bestTime) ? stats.bestTime : Number.POSITIVE_INFINITY
    const bestJumps =
      typeof stats.bestJumps === "number" && !isNaN(stats.bestJumps) ? stats.bestJumps : Number.POSITIVE_INFINITY
    const lowestDeaths =
      typeof stats.lowestDeaths === "number" && !isNaN(stats.lowestDeaths)
        ? stats.lowestDeaths
        : Number.POSITIVE_INFINITY
    const perfectRuns = typeof stats.perfectRuns === "number" && !isNaN(stats.perfectRuns) ? stats.perfectRuns : 0
    const totalRuns = typeof stats.totalRuns === "number" && !isNaN(stats.totalRuns) ? stats.totalRuns : 0
    const totalDeaths = typeof stats.totalDeaths === "number" && !isNaN(stats.totalDeaths) ? stats.totalDeaths : 0
    // Show up to 5 most recent runs for display
    const runs = Array.isArray(stats.runs) ? stats.runs.slice(0, 5) : []

    // Clear existing content
    scoreboard.innerHTML = ""

    // Create and append the title (h3) using textContent to safely handle filename
    const title = document.createElement("h3")
    title.textContent = `${filename} Stats`
    title.style.cssText = "margin: 0 0 15px 0; color: #00ff00; text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);"
    scoreboard.appendChild(title)

    // Best stats section
    const bestStatsDiv = document.createElement("div")
    bestStatsDiv.style.cssText =
      "background: rgba(0, 255, 0, 0.1); padding: 15px; border-radius: 10px; margin-bottom: 15px;"
    bestStatsDiv.innerHTML = `
            <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>Best Time:</span>
                <span style="color: #00ff00;">${this.formatTime(bestTime)}</span>
            </div>
            <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>Best Jumps:</span>
                <span style="color: #00ff00;">${bestJumps === Number.POSITIVE_INFINITY ? "--" : bestJumps}</span>
            </div>
            <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>Lowest Deaths:</span>
                <span style="color: #00ff00;">${lowestDeaths === Number.POSITIVE_INFINITY ? "--" : lowestDeaths}</span>
            </div>
            <div style="margin-bottom: 8px; display: flex; justify-content: space-between;">
                <span>Perfect Runs:</span>
                <span style="color: #00ff00;">${perfectRuns}</span>
            </div>
        `
    scoreboard.appendChild(bestStatsDiv)

    // Total stats section
    const totalStatsDiv = document.createElement("div")
    totalStatsDiv.style.cssText = "background: rgba(0, 255, 0, 0.05); padding: 15px; border-radius: 10px;"
    totalStatsDiv.innerHTML = `
            <h4 style="margin: 0 0 10px 0; color: #00ff00;">Total Stats</h4>
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span>Total Runs:</span>
                <span>${totalRuns}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Total Deaths:</span>
                <span>${totalDeaths}</span>
            </div>
        `
    scoreboard.appendChild(totalStatsDiv)

    // Recent runs section (if applicable)
    if (runs.length > 0) {
      const recentRunsDiv = document.createElement("div")
      recentRunsDiv.style.cssText = "margin-top: 15px; max-height: 270px; overflow-y: auto;"
      recentRunsDiv.className = "recent-runs-scroll"
      recentRunsDiv.innerHTML = `
                <h4 style="margin: 0 0 10px 0; color: #00ff00;">Recent Runs</h4>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                ${runs
                  .map(
                    (run) => `
                    <div style="background: rgba(0, 255, 0, 0.05); padding: 10px; border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span>${this.formatTime(run.time)}</span>
                            <span>${run.jumps} jumps</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.9em; color: #aaa;">
                            <span>${run.deaths} deaths</span>
                            <span>${new Date(run.date).toLocaleDateString()}</span>
                        </div>
                    </div>
                `,
                  )
                  .join("")}
                </div>
            `
      scoreboard.appendChild(recentRunsDiv)
    }
  },

  // Format time for display
  formatTime(time) {
    return time === Number.POSITIVE_INFINITY ? "--" : time.toFixed(1) + "s"
  },

  // Create scoreboard UI
  createScoreboardUI() {
    const scoreboard = document.createElement("div")
    scoreboard.id = "scoreboard"
    scoreboard.className = "scoreboard-animate-in"
    scoreboard.style.cssText = `
        position: fixed;
        right: 20px;
        top: 50%;
        transform: translateY(-50%);
        background: linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6));
        color: white;
        padding: 20px;
        border-radius: 15px;
        font-family: 'Orbitron', sans-serif;
        min-width: 250px;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.2);
        border: 1px solid rgba(0, 255, 0, 0.1);
        backdrop-filter: blur(10px);
        z-index: 1000;
        overflow: visible;
    `
    document.body.appendChild(scoreboard)
    return scoreboard
  },

  // Create menu scoreboard UI
  createMenuScoreboardUI() {
    const menuScoreboard = document.createElement("div")
    menuScoreboard.id = "menuScoreboard"
    menuScoreboard.style.cssText = `
            position: fixed;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            background: linear-gradient(135deg, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.6));
            color: white;
            padding: 20px;
            border-radius: 15px;
            font-family: 'Orbitron', sans-serif;
            min-width: 300px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.2);
            border: 1px solid rgba(0, 255, 0, 0.1);
            backdrop-filter: blur(10px);
            z-index: 1000;
        `
    document.body.appendChild(menuScoreboard)
    return menuScoreboard
  },

  // Update menu scoreboard UI
  updateMenuScoreboardUI() {
    debug("scoreManager", "Updating menu scoreboard UI")
    let menuScoreboard = document.getElementById("menuScoreboard")
    if (!menuScoreboard) {
      menuScoreboard = this.createMenuScoreboardUI()
    }

    let html =
      '<h2 style="margin: 0 0 20px 0; color: #00ff00; text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);">Level Statistics</h2>'

    const levelIds = Array.from(this.scores.levels.keys()).sort((a, b) => {
      const numA = Number.parseInt(a.replace("level", ""))
      const numB = Number.parseInt(b.replace("level", ""))
      return numA - numB
    })

    for (const levelId of levelIds) {
      const stats = this.getLevelStats(levelId)
      html += `
                <div style="margin-bottom: 20px; border: 1px solid rgba(0, 255, 0, 0.1); border-radius: 10px; padding: 15px; background: rgba(0, 255, 0, 0.05);">
                    <h3 style="margin: 0 0 10px 0; color: #00ff00; text-shadow: 0 0 10px rgba(0, 255, 0, 0.3);">${levelId}</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                        <div>Best Time: ${this.formatTime(stats.bestTime)}</div>
                        <div>Best Jumps: ${stats.bestJumps === Number.POSITIVE_INFINITY ? "--" : stats.bestJumps}</div>
                        <div>Perfect Runs: ${stats.perfectRuns}</div>
                        <div>Total Deaths: ${stats.totalDeaths}</div>
                    </div>
                    ${
                      stats.runs.length > 0
                        ? `
                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(0, 255, 0, 0.1);">
                            <div style="font-size: 0.9em; color: #00ff00;">Last Run:</div>
                            <div style="display: flex; justify-content: space-between; color: #aaa;">
                                <span>${this.formatTime(stats.runs[0].time)}</span>
                                <span>${stats.runs[0].jumps} jumps</span>
                                <span>${stats.runs[0].deaths} deaths</span>
                            </div>
                        </div>
                    `
                        : ""
                    }
                </div>
            `
    }

    if (levelIds.length === 0) {
      html += '<div style="color: #aaa; text-align: center; padding: 20px;">No levels completed yet</div>'
    }

    menuScoreboard.innerHTML = html
  },
}

export { ScoreManager }
