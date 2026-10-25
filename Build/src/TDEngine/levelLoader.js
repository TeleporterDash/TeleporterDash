// Level Loader for Teleporter Dash
import { GameState } from "../Utilities/gameState.js";
import { COLOR_MAP, CONSTANTS } from "../Utilities/constants.js";
import { AudioManager } from "../Utilities/audioManager.js";
import { DatabaseManager } from "../Utilities/databaseManager.js";
import { SettingsManager } from "./settingsManager.js";
import {
  showLoadingError,
  showError,
} from "../Utilities/notificationManager.js";
import { DOMManager } from "../Utilities/domManager.js";

// Global variables needed for level loading
let levelColorSteps = [];
let levelColorIndex = 0;
let levelTransitionFactor = 0;
let levelMusic = null;

const player = DOMManager.getElement("#player");
const progressFill = DOMManager.getElement("#progressFill");
const progressText = DOMManager.getElement("#progressText");

export const LevelLoader = {
  WORKER_URL: "https://tdserver.neeljaiswal23.workers.dev",

  // Load from static built-in level file
  async loadFromStatic(id) {
    // level1.js, level2.js, level3.js are the real campaign levels
    // level-1.js, level-2.js, level-3.js are test levels
    const filename = id < 0 ? `./public/Levels/level-${Math.abs(id)}.js` : `./public/Levels/level${id}.js`;
    return new Promise((resolve, reject) => {
      delete window.levelData;
      const script = document.createElement("script");
      script.src = filename;
      script.onload = () => {
        if (!window.levelData) {
          reject(new Error("Failed to load built-in level data"));
          return;
        }
        const data = window.levelData;
        delete window.levelData;
        script.remove();
        resolve(data);
      };
      script.onerror = () => {
        script.remove();
        reject(new Error(`Failed to load built-in level: ${filename}`));
      };
      document.head.appendChild(script);
    });
  },

  // // Load from Cloudflare Worker API
  async loadFromWorker(id) {
    const resp = await fetch(`${this.WORKER_URL}/level/${id}`);
    if (!resp.ok) throw new Error(`Worker returned ${resp.status}`);
    const levels = await resp.json();
    if (!levels || levels.length === 0) throw new Error("Empty response");
    return levels[0];
  },

  // // Load from IndexedDB
  async loadFromIndexedDB(filename) {
    return await DatabaseManager.loadFromIndexedDB(filename);
  },

  // // Load Test Level
  async loadTestLevel() {
    try {
      const testData = await DatabaseManager.loadTestLevel("currentTest");
      if (testData) {
        return {
          matrix: testData.matrix,
          title: "Test Level",
          author: testData.author,
          difficulty: testData.difficulty,
          musicValue: testData.musicValue,
          musicData: testData.musicData,
          id: "test",
          colorTransitionDuration: 2.0,
          colorTransitionDelay: 0.2,
        };
      } else {
        throw new Error("No test level found");
      }
    } catch (error) {
      console.error("Error loading test level:", error);
      throw error;
    }
  },

  // // Initialize Level Data
  async initializeLevelData() {
    try {
      const urlParams = new URLSearchParams(window.location.search);

      // Test level from the editor
      if (urlParams.has("test") && urlParams.get("test") === "true") {
        console.log("Loading test level from editor");
        const testData = await this.loadTestLevel();
        await this.processLevelData(testData);
        const state = GameState.getState();
        if (state.isPracticeMode) {
          this.initializePracticeMode();
        }
        return;
      }

      // Online levels
      if (urlParams.has("online") && urlParams.get("online") === "true") {
        console.log("Loading online level");
        const levelTitle = urlParams.get("levelFile");
        console.log("Loading level:", levelTitle);

        try {
          await DatabaseManager.initDB();
          const level = await this.loadFromIndexedDB(levelTitle);
          console.log("Level loaded from IndexedDB:", level);

          if (!level || !level.matrix) {
            throw new Error("Invalid level data");
          }

          await this.processLevelData(level);
          console.log("Level processed successfully");
        } catch (error) {
          console.error("Error loading online level:", error);
          showLoadingError(`Failed to load level: ${error.message}`);
          throw error;
        }
        return;
      }

      // Built-in levels
      if (urlParams.has("level")) {
        console.log("Loading built-in level");
        const levelNumber = urlParams.get("level");
        if (!/^-?\d+$/.test(levelNumber)) {
          showLoadingError("Invalid level number");
          return;
        }
        GameState.setState({ levelId: levelNumber });
        console.log("Loading level:", levelNumber);

        const levelNum = parseInt(levelNumber);
        // Campaign levels 1-3 load from static files, negative load from test files, others from Worker
        const levelData =
          (levelNum >= 1 && levelNum <= 3) || levelNum < 0
            ? await this.loadFromStatic(levelNum)
            : await this.loadFromWorker(levelNum);
        await this.processLevelData(levelData);
        const state = GameState.getState();
        if (state.isPracticeMode) {
          this.initializePracticeMode();
        }
      }
    } catch (error) {
      console.error("Error initializing level data:", error);
      showLoadingError(`Failed to initialize level: ${error.message}`);
      throw error;
    }
  },

  async processLevelData(data) {
    if (!data || !data.matrix) {
      throw new Error("Invalid level data: missing matrix");
    }

    console.log("Processing level data:", data); // Debug log

    // For built-in levels, first row is already the color row
    GameState.setState({
      levelMatrix: data.matrix.slice(1),
      levelColorRow: data.matrix[0],
    });

    // Process colors
    levelColorSteps.length = 0;
    const state = GameState.getState();
    const uniqueColors = [...new Set(state.levelColorRow)]
      .filter((code) => {
        // Handle both simple color codes and block properties
        if (typeof code === "string") {
          const props = code.split("/");
          return props.some((p) => p.startsWith("-"));
        }
        return code < 0;
      })
      .map((code) => {
        // Extract color from block properties if needed
        if (typeof code === "string") {
          const props = code.split("/");
          const colorProp = props.find((p) => p.startsWith("-"));
          return parseInt(colorProp);
        }
        return code;
      });

    uniqueColors.forEach((code) => {
      const color = COLOR_MAP[code];
      if (color) {
        levelColorSteps.push(color);
      }
    });

    // If we only have one color, duplicate it
    if (levelColorSteps.length === 1) {
      console.log("Only one color found, duplicating it");
      levelColorSteps.push(levelColorSteps[0]);
    }

    // Reset color transition
    levelColorIndex = 0;
    levelTransitionFactor = 0;

    // Set initial background color
    const gameContainer = DOMManager.getElement("#gameContainer");
    if (gameContainer && levelColorSteps.length > 0) {
      gameContainer.style.backgroundColor = levelColorSteps[0];
    }

    // Set other level data
    GameState.setState({
      levelTitle: data.title || "Untitled Level",
      levelAuthor: data.author || "Unknown Author",
      levelDifficulty: data.difficulty || "Normal",
    });

    // Handle music data
    console.log(
      "Music data - musicValue:",
      data.musicValue,
      "music:",
      data.music,
      "musicData:",
      !!data.musicData,
    );
    if (data.musicValue === "custom" && data.musicData) {
      console.log("Using custom music");
      const blob = new Blob([data.musicData.data], {
        type: data.musicData.type,
      });
      const musicUrl = URL.createObjectURL(blob);
      GameState.setState({ levelMusic: musicUrl });
      console.log("LevelMusic: ", musicUrl);
    } else if (GameState.getState().isPracticeMode) {
      console.log("Using practice mode music");
      GameState.setState({
        levelMusic: "./Sound/Basic Soundeffects/practicetd.ogg",
      });
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    } else if (
      data.musicValue &&
      data.musicValue.startsWith("./Sound/Level Soundtracks/")
    ) {
      console.log(
        "Using musicValue that starts with ./Sound/Level Soundtracks/",
      );
      GameState.setState({ levelMusic: data.musicValue });
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    } else if (data.musicValue) {
      console.log("Using musicValue with public prefix");
      // If musicValue is already a full path, use it directly
      if (data.musicValue.includes("/")) {
        GameState.setState({ levelMusic: data.musicValue });
      } else {
        GameState.setState({
          levelMusic: `./Sound/Level Soundtracks/${data.musicValue}`,
        });
      }
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    } else if (data.musicData) {
      console.log("Using musicData directly");
      GameState.setState({ levelMusic: data.musicData });
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    } else if (
      data.music &&
      data.music.startsWith("../Sound/Level Soundtracks/")
    ) {
      console.log("Using music that starts with ../Sound/Level Soundtracks/");
      GameState.setState({ levelMusic: data.music });
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    } else if (data.music) {
      console.log("Using music with path check");
      // If music is already a full path, use it directly
      if (data.music.includes("/")) {
        GameState.setState({ levelMusic: data.music });
      } else {
        // Otherwise, construct the path
        GameState.setState({
          levelMusic: `../Sound/Level Soundtracks/${data.music}`,
        });
      }
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    } else {
      console.log("Using fallback music");
      GameState.setState({
        levelMusic: "./Sound/Level Soundtracks/level1.ogg",
      });
      console.log("LevelMusic: ", GameState.getState().levelMusic);
    }

    // Ensure Safari gets .mp3 instead of .ogg
    if (AudioManager.isSafari() && !levelMusic.endsWith(".mp3")) {
      levelMusic = levelMusic.replace(/\.\w+$/, ".mp3");
      console.log("LevelMusic: ", levelMusic);
    }

    GameState.setState({ levelId: data.id });
    const currentState = GameState.getState();
    document.title = currentState.levelTitle;

    // Initialize audio with the new level music
    const audioState = GameState.getState();
    await AudioManager.setup(audioState.levelMusic);

    // Reset game state
    GameState.setState({
      gameSpeed: 4,
      currentColumn: 0,
      playerVelocity: 0,
      rotation: 0,
      isOnPlatform: false,
      doubleJumpAvailable: true,
      passedBlocks: 0,
      isLevelStarted: false,
      isGameOver: false,
      isPaused: false,
      isLevelComplete: false,
    });

    // Reset progress bar
    progressFill.style.width = "0%";
    progressText.textContent = "0%";

    // Reset player position
    player.style.bottom = `${CONSTANTS.GROUND_HEIGHT}px`;
    player.style.transform = "rotate(0deg)";

    // Reset camera position
    GameState.setState({ cameraOffsetY: 0 });
  },
  // // Initialize Practice Mode
  initializePracticeMode() {
    const gameSpeedSelect = DOMManager.getElement("#gameSpeed");
    if (gameSpeedSelect) {
      gameSpeedSelect.disabled = false;
      const savedSpeed = SettingsManager.current.gameSpeed;
      if (savedSpeed) {
        GameState.setState({ gameSpeed: savedSpeed });
        gameSpeedSelect.value = savedSpeed.toString();
      }
    }

    // Switch to practice mode music
    const state = GameState.getState();
    if (
      state.isLevelStarted &&
      !state.isPaused &&
      !state.isGameOver &&
      !state.isLevelComplete
    ) {
      try {
        AudioManager.switchTracks(
          AudioManager.practiceMusic,
          AudioManager.backgroundMusic,
        );
      } catch (error) {
        console.error("Error switching to practice mode music:", error);
      }
    }
  },
};
