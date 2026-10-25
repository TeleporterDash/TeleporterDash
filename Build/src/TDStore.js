import { DatabaseManager } from "./Utilities/databaseManager.js";
import { DOMManager } from "./Utilities/domManager.js";
import "./Utilities/levelPreview.js";

const WORKER_URL = "https://tdserver.neeljaiswal23.workers.dev";

const storeLevels = [];

// Load levels from Worker API
async function loadStoreLevels() {
  try {
    storeLevels.length = 0;

    DOMManager.getElement("#levelGrid").innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center;">
                        Loading levels...
                    </div>`;

    // Use ?full=true to get matrices for preview rendering
    const resp = await fetch(`${WORKER_URL}/levels?full=true`);
    if (!resp.ok) throw new Error(`Worker returned ${resp.status}`);
    const levels = await resp.json();

    if (!Array.isArray(levels) || levels.length === 0) {
      throw new Error("No levels returned");
    }

    storeLevels.push(...levels);
    displayLevels(storeLevels);
  } catch (error) {
    console.error("Error loading levels:", error);
    DOMManager.getElement("#levelGrid").innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; color: red;">
                        Failed to load levels. Please try again later.
                    </div>`;
  }
}

// Play a level (navigates to game with Worker-served level)
function playLevel(levelId) {
  window.location.href = `TDLoader.html?level=${levelId}`;
}

// Level Display System
function displayLevels(levels) {
  const levelGrid = DOMManager.getElement("#levelGrid");

  if (!levels || levels.length === 0) {
    levelGrid.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center;">
                        No levels found.
                    </div>`;
    return;
  }

  levelGrid.innerHTML = "";

  levels.forEach((level) => {
    try {
      const card = createLevelCard(level);
      if (card) levelGrid.appendChild(card);
    } catch (error) {
      console.error(`Error creating card for level ${level.id}:`, error);
    }
  });

  if (levelGrid.children.length === 0) {
    levelGrid.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center;">
                        Error displaying levels. Please try again later.
                    </div>`;
  }
}

function createLevelCard(level) {
  if (!level || !level.title) {
    console.error("Invalid level data:", level);
    return null;
  }

  const card = document.createElement("div");
  card.className = "level-card";
  card.id = `card-${level.id}`;
  card.setAttribute("data-id", level.id);

  const previewCanvas = document.createElement("canvas");
  previewCanvas.className = "level-preview";
  previewCanvas.width = 500;
  previewCanvas.height = 200;

  if (level.matrix) {
    drawLevelPreview(previewCanvas, level);
  } else {
    const ctx = previewCanvas.getContext("2d");
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, 500, 200);
    ctx.fillStyle = "#666";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tap Play to preview", 250, 100);
  }

  const infoDiv = document.createElement("div");
  infoDiv.className = "level-info";

  const title = document.createElement("h3");
  title.className = "level-title";
  title.textContent = level.title || `Level ${level.id}`;

  const author = document.createElement("p");
  author.className = "level-author";
  author.textContent = level.author || "Unknown Author";

  const stats = document.createElement("div");
  stats.className = "level-stats";
  stats.innerHTML = `
                    <span>Rating: ${level.rating ? level.rating.toFixed(1) : "0.0"}</span>
                    <span>Comments: ${level.commentCount || 0}</span>
                    <span>Played ${level.plays || 0} times</span>
                `;

  const buttonContainer = document.createElement("div");
  buttonContainer.className = "button-container";

  // Check if already downloaded for offline play
  const isDownloaded = window.downloadedLevels && window.downloadedLevels[level.id];
  const downloadBtn = document.createElement("button");
  downloadBtn.className = "download-button" + (isDownloaded ? " downloaded" : "");
  downloadBtn.textContent = isDownloaded ? "Play Offline" : "Download for Offline";
  downloadBtn.onclick = () => downloadLevel(level.id);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-button" + (isDownloaded ? "" : " hidden");
  deleteBtn.textContent = "Delete";
  deleteBtn.title = "Remove from offline storage";
  deleteBtn.onclick = async () => {
    if (confirm(`Are you sure you want to remove "${level.title}" from offline storage?`)) {
      try {
        await DatabaseManager.deleteLevel(`level${level.id}.js`);
        window.downloadedLevels[level.id] = false;
        deleteBtn.className = "delete-button hidden";
        downloadBtn.className = "download-button";
        downloadBtn.textContent = "Download for Offline";
        downloadBtn.onclick = () => downloadLevel(level.id);
      } catch (error) {
        console.error("Failed to delete:", error);
        alert("Failed to remove level. Please try again.");
      }
    }
  };

  buttonContainer.appendChild(downloadBtn);
  buttonContainer.appendChild(deleteBtn);
  infoDiv.appendChild(title);
  infoDiv.appendChild(author);
  infoDiv.appendChild(stats);

  card.appendChild(previewCanvas);
  card.appendChild(infoDiv);
  card.appendChild(buttonContainer);

  return card;
}

// Download level for offline play (IndexedDB)
async function downloadLevel(levelId) {
  try {
    const resp = await fetch(`${WORKER_URL}/level/${levelId}`);
    if (!resp.ok) throw new Error(`Worker returned ${resp.status}`);
    const levels = await resp.json();
    if (!levels || levels.length === 0) throw new Error("Level not found");

    const level = levels[0];
    level.filename = `level${levelId}.js`;
    level.dateDownloaded = new Date().toISOString();

    await DatabaseManager.putLevel(level);
    window.downloadedLevels = window.downloadedLevels || {};
    window.downloadedLevels[levelId] = true;

    // Update the card UI
    const card = document.querySelector(`[data-id="${levelId}"]`);
    if (card) {
      const dlBtn = card.querySelector(".download-button");
      const delBtn = card.querySelector(".delete-button");
      if (dlBtn) {
        dlBtn.className = "download-button downloaded";
        dlBtn.textContent = "Play Offline";
        dlBtn.onclick = () => playLevelOffline(levelId);
      }
      if (delBtn) delBtn.className = "delete-button";
    }

    alert(`"${level.title}" saved for offline play!`);
  } catch (error) {
    console.error("Download failed:", error);
    alert("Failed to download level. Check your connection and try again.");
  }
}

// Play a downloaded (offline) level
function playLevelOffline(levelId) {
  window.location.href = `TDLoader.html?online=true&levelFile=level${levelId}.js`;
}

// Load downloaded levels status for offline play indicator
async function loadDownloadedStatus() {
  window.downloadedLevels = {};
  try {
    const levels = await DatabaseManager.getDownloadedLevels();
    levels.forEach((level) => {
      const id = level.filename ? level.filename.match(/level(\d+)\.js/)?.[1] : null;
      if (id) window.downloadedLevels[id] = true;
    });
  } catch (error) {
    console.error("Failed to load downloaded status:", error);
  }
}

// Search and Filter Levels (client-side)
function searchLevels(query) {
  const filtered = storeLevels.filter((level) =>
    level.title.toLowerCase().includes(query.toLowerCase()),
  );
  displayLevels(filtered);
}

function filterLevels(criteria) {
  let filtered = [...storeLevels];
  switch (criteria) {
    case "newest":
      filtered.sort((a, b) => b.id - a.id);
      break;
    case "popular":
      filtered.sort((a, b) => (b.plays || 0) - (a.plays || 0));
      break;
    case "top":
      filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
  }
  displayLevels(filtered);
}

// Initialize on page load
window.onload = async () => {
  try {
    await DatabaseManager.initDB();
    console.log("Database initialized");
    await loadDownloadedStatus();
    await loadStoreLevels();
    console.log("Levels loaded");
  } catch (error) {
    console.error("Failed to initialize:", error);
    DOMManager.getElement("#levelGrid").innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; color: red;">
                        Error initializing level store. Please try again later.
                    </div>`;
  }
};

// Export for HTML onclick
// @ts-ignore
window.searchLevels = searchLevels;
// @ts-ignore
window.filterLevels = filterLevels;