import {
  log,
  warn,
  error,
  debug,
  verbose,
  setLogLevel,
} from "./Modules/logManager";
import AudioManager from "./Modules/audioManager";
import { MatrixParser } from "./Modules/matrixParser";
import { Player, PhysicsEngine, AudioManagerLike } from "./Modules/physicsEngine";
import { getTeleportTarget } from "./Modules/teleporterEngine";
import { isObjectActive, setRenderEngine } from "./Modules/groupManager";
import { loadSprites } from "./Modules/spriteManager";
import { RenderEngine } from "./Modules/renderEngine";
import { ParticleSystem } from "./Modules/visualEffectsEngine";
import { pregenerateTextures } from "./Modules/animationEngine";
import CameraManager from "./Modules/cameraManager";
import musicSync, { MusicSync } from "./Modules/musicSync";
import { Application, WebGLRenderer, VERSION } from "pixi.js";
import { gameLoop } from "./Modules/gameLoop";

// Create global instances
window.audioManager = new AudioManager();
window.autoRestart = true; // Default to auto restart

// Now we can set the log level after importing it
setLogLevel("verbose");

// Global variables (all initialized through window object)
window.pixiApp = null;
window.spriteMap = null;
window.renderEngine = null;
window.physicsEngine = null;
window.player = null;
window.parsedMatrix = null;
window.particleSystem = null;
window.musicSync = null;
window.cameraManager = null;
window.score = 0;
window.isPaused = false;
window.keys = {};
window.blockSize = 32;
window.pixiInitialized = false;
window.gameStarted = false;
window.isInitializing = false;

const getErrorMessage = (exception: unknown): string =>
  exception instanceof Error ? exception.message : String(exception);

const setMatrixOutput = (message: string): void => {
  const matrixOutput = document.getElementById(
    "matrixOutput"
  ) as HTMLTextAreaElement | null;
  if (matrixOutput) {
    matrixOutput.value = message;
  }
};

const enableControlButtons = (): void => {
  document
    .querySelectorAll<HTMLButtonElement>(".controls button")
    .forEach((button) => {
      button.disabled = false;
    });
};

async function initPixi(): Promise<void> {
  if (window.isInitializing) {
    warn("combinedTest", "Initialization already in progress, skipping...");
    return;
  }

  window.isInitializing = true;
  try {
    // Create PIXI Application
    if (!window.pixiApp) {
      window.pixiApp = new Application();
      if (!window.pixiApp) return;
      await window.pixiApp.init({
        canvas: document.getElementById("levelCanvas") as HTMLCanvasElement,
        width: 512,
        height: 256,
        backgroundColor: 0x222222,
        antialias: true,
        autoStart: true,
        useBackBuffer: true,
      });
    }

    verbose("combinedTest", "PixiJS version:", VERSION || "unknown");
    debug(
      "combinedTest",
      "Renderer type:",
      window.pixiApp.renderer instanceof WebGLRenderer ? "WebGL" : "Canvas"
    );

    // Load sprite assets if not already loaded
    if (!window.spriteMap) {
      window.spriteMap = await loadSprites("assets/Sprites");
    }

    if (window.spriteMap.has("floor")) {
      verbose("initPixi", "Found 'floor.svg' data in spriteMap.");
    } else {
      warn(
        "initPixi",
        "Could not find 'floor.svg' data in spriteMap to map to type 'floor'. Ensure Sprites/floor.svg exists."
      );
    }

    // Create RenderEngine if not already created
    if (!window.renderEngine) {
      window.renderEngine = new RenderEngine(window.pixiApp, window.blockSize);
      setRenderEngine(window.renderEngine);
      window.renderEngine.setAudioManager(window.audioManager);
      // Get the particle system from renderEngine
      window.particleSystem = window.renderEngine.particleSystem;
    }

    // Initialize audio if not already initialized
    if (!window.audioManager.isInitialized) {
      await window.audioManager.initialize(
        "../assets/Sound/Level Soundtracks/level1"
      );
    }

    // Initialize musicSync if not already initialized
    if (!window.musicSync) {
      window.musicSync = new MusicSync(window.audioManager);
    }

    debug("combinedTest", "PixiJS initialized, sprites loaded");
    window.pixiInitialized = true;

    // Enable controls
    enableControlButtons();
  } catch (err) {
    error("combinedTest", "PixiJS initialization failed:", err);
    setMatrixOutput(`Error: ${getErrorMessage(err)}`);
    throw err;
  } finally {
    window.isInitializing = false;
  }
}

async function initializeGameFromMatrix(): Promise<void> {
  if (window.isInitializing) {
    warn("gameTest", "Initialization already in progress, skipping...");
    return;
  }

  window.isInitializing = true;
  try {
    debug("gameTest", "Initializing game from matrix...");
    const matrixInput = document.getElementById(
      "matrixInput"
    ) as HTMLTextAreaElement;
    const parsedMatrix = MatrixParser.parse(JSON.parse(matrixInput.value));
    window.parsedMatrix = parsedMatrix;

    const renderEngine = window.renderEngine;
    const spriteMap = window.spriteMap;
    const pixiApp = window.pixiApp;

    if (!renderEngine) {
      throw new Error("Render engine is not initialized");
    }

    if (!spriteMap) {
      throw new Error("Sprite map is not loaded");
    }

    if (!pixiApp) {
      throw new Error("Pixi application is not initialized");
    }

    const activeRenderEngine = renderEngine;
    activeRenderEngine.matrix = parsedMatrix;
    activeRenderEngine.blockSprites = []; // Clear existing sprites
    activeRenderEngine.spriteMap = spriteMap;
    await activeRenderEngine.renderMatrix(parsedMatrix, spriteMap);

    // renderMatrix() now handles floor rendering, so we don't need to check here
    // Floor should already exist after renderMatrix completes

    let cameraManager = window.cameraManager;
    if (!cameraManager) {
      cameraManager = new CameraManager(
        activeRenderEngine.container,
        parsedMatrix[0].length * window.blockSize,
        (parsedMatrix.length + 2) * window.blockSize, // +2 to include floor space
        pixiApp.canvas.width,
        pixiApp.canvas.height
      );
      window.cameraManager = cameraManager;
    } else {
      cameraManager.setBounds(
        0,
        parsedMatrix[0].length * window.blockSize,
        0,
        (parsedMatrix.length + 2) * window.blockSize // +2 to include floor space
      );
    }

    const originalTickerCallback = activeRenderEngine.tickerCallback;
    activeRenderEngine.tickerCallback = (delta: number) => {
      if (originalTickerCallback) {
        originalTickerCallback(delta);
      }
      // Camera update is now handled inside the renderEngine game loop
    };

    const audioManagerAdapter: AudioManagerLike = {
      playJumpSound: () => window.audioManager.playJumpSound?.(),
      playDeathSound: () => window.audioManager.playDeathSound?.(),
      playCompletionSound: () => window.audioManager.playCompletionSound?.(),
      pauseBackgroundMusic: () => window.audioManager.pauseBackgroundMusic(),
      get restartMusicOnDeath() {
        return window.audioManager.restartMusicOnDeath;
      },
      set restartMusicOnDeath(value: boolean | undefined) {
        if (typeof value === "boolean") {
          window.audioManager.restartMusicOnDeath = value;
        }
      },
      get backgroundMusic() {
        if (!window.audioManager.backgroundMusic) {
          return undefined;
        }
        return {
          get currentTime(): number {
            const position = window.audioManager.backgroundMusic?.seek();
            if (typeof position === "number") {
              return position;
            }
            return window.audioManager.backgroundMusicTime ?? 0;
          },
        };
      },
      set backgroundMusic(value: { currentTime?: number } | undefined) {
        if (
          value &&
          typeof value.currentTime === "number" &&
          window.audioManager.backgroundMusic
        ) {
          window.audioManager.backgroundMusic.seek(value.currentTime);
          window.audioManager.backgroundMusicTime = value.currentTime;
        }
      },
      get backgroundMusicTime() {
        return window.audioManager.backgroundMusicTime;
      },
      set backgroundMusicTime(value: number | undefined) {
        window.audioManager.backgroundMusicTime = value ?? 0;
      },
      get isMuted() {
        return window.audioManager.isMuted;
      },
    };

    // IMPORTANT: Create player BEFORE physics engine so physics can use the correct player position
    if (!window.player) {
      const startX = 1; // One block in from the left
      const startY = parsedMatrix.length - 2; // Two blocks up from the bottom
      debug(
        "gameTest",
        `Creating player at (${startX}, ${startY}) in level ${parsedMatrix[0].length}x${parsedMatrix.length}`
      );
      window.player = new Player(
        startX,
        startY,
        parsedMatrix[0].length,
        parsedMatrix.length,
        null // Physics engine doesn't exist yet
      );
      window.player.renderEngine = activeRenderEngine;
    }

    if (!window.physicsEngine) {
      window.physicsEngine = new PhysicsEngine(
        parsedMatrix,
        window.player, // Now player exists!
        activeRenderEngine,
        audioManagerAdapter,
        cameraManager
      );
      // Link player to physics engine
      window.player.physicsEngine = window.physicsEngine;
    } else {
      window.physicsEngine.updateMatrix(parsedMatrix);
    }

    // Render the player sprite BEFORE starting the game loop
    if (window.physicsEngine && !activeRenderEngine.playerSprite) {
      try {
        console.log("[main] About to render player at position:", window.player.x, window.player.y);
        await activeRenderEngine.renderPlayer(window.player);
        console.log("[main] Player sprite created:", activeRenderEngine.playerSprite);
      } catch (err) {
        console.error("[main] Error rendering player:", err);
      }
    }

    // NOW set camera position based on player position (after player sprite exists)
    const playerPixelX = window.player.x * window.blockSize;
    const playerPixelY = window.player.y * window.blockSize;
    const cameraStartX = playerPixelX - pixiApp.canvas.width / 2;
    const cameraStartY = playerPixelY - pixiApp.canvas.height / 2;
    cameraManager.setPosition(cameraStartX, cameraStartY);

    // Only start game loop if it hasn't been started
    if (!window.gameStarted) {
      // Start the visual ticker for animations
      activeRenderEngine.startGameLoop(window.player, window.physicsEngine);
      
      // Register systems with the new unified game loop
      gameLoop.registerSystems({
        physics: window.physicsEngine,
        renderer: activeRenderEngine,
        camera: cameraManager,
      });
      
      // Start the unified game loop
      gameLoop.start();
      
      window.gameStarted = true;
    }

    // Update the matrix output
    setMatrixOutput(JSON.stringify(parsedMatrix, null, 2));
  } catch (err) {
    error("gameTest", "Error initializing game:", err);
    setMatrixOutput(`Error: ${getErrorMessage(err)}`);
  } finally {
    window.isInitializing = false;
  }
}

async function updateGameMatrix(): Promise<void> {
  if (!window.gameStarted || !window.physicsEngine || !window.renderEngine) {
    warn(
      "gameTest",
      "Cannot update matrix: game not started or engines not initialized."
    );
    return;
  }
  try {
    debug("gameTest", "Updating game matrix...");
    const matrixInput = document.getElementById(
      "matrixInput"
    ) as HTMLTextAreaElement;
    const newParsedMatrix = MatrixParser.parse(JSON.parse(matrixInput.value));

    // Update engines with the new matrix (PhysicsEngine needs updateMatrix method)
    window.parsedMatrix = newParsedMatrix; // Update global matrix reference
    window.physicsEngine.updateMatrix(newParsedMatrix);
    // Re-render using the updated matrix
    const spriteMap = window.spriteMap;
    if (!spriteMap) {
      throw new Error("Sprite map is not loaded");
    }
    await window.renderEngine.renderMatrix(newParsedMatrix, spriteMap);
    // Optionally, reset player position or state here if needed
    // player.resetPosition(newStartX, newStartY);
    debug("gameTest", "Game matrix updated and re-rendered.");
  } catch (err) {
    error("gameTest", "Error updating matrix:", err);
    setMatrixOutput(`Error: ${getErrorMessage(err)}`);
  }
}

async function handleApplyMatrixClick(): Promise<void> {
  const applyButton = document.getElementById(
    "applyMatrixButton"
  ) as HTMLButtonElement;
  if (applyButton) applyButton.disabled = true; // Disable button immediately

  if (!window.gameStarted) {
    debug("gameTest", "Game not started, initializing...");
    await initializeGameFromMatrix();
  } else {
    debug("gameTest", "Game started, updating matrix...");
    await updateGameMatrix();
  }
}

async function restartGame(): Promise<void> {
  console.log("Restarting game...");
  if (!window.pixiInitialized) {
    console.warn("Game not initialized, cannot restart.");
    return;
  }

  // Hide game over screen if visible
  const gameOverScreen = document.getElementById(
    "gameOverScreen"
  ) as HTMLElement;
  if (gameOverScreen) {
    gameOverScreen.style.display = "none";
  }

  // PAUSE the game loop during restart to prevent updates while sprites are being recreated
  gameLoop.pause();

  // 1. Reset visual effects first
  if (window.renderEngine) {
    // Reset any active visual effects
    if (window.renderEngine.particleSystem) {
      window.renderEngine.particleSystem.reset();
    }
  }

  // 2. Reset Player State
  if (window.player) {
    window.player.reset();
  } else {
    console.error("Player not found during restart!");
    gameLoop.resume();
    return; // Cannot proceed without player
  }

  // 3. Reset Physics (must be before rendering so player body position is correct)
  if (window.physicsEngine) {
    verbose("gameTest", "Resetting physics engine...");
    window.physicsEngine.reset();
  }

  // 4. Reset audio
  if (window.audioManager) {
    window.audioManager.pauseBackgroundMusic();
    window.audioManager.playBackgroundMusic();
  }

  if (window.musicSync) {
    window.musicSync.reset();
  }

  // 5. Re-render EVERYTHING (level + player)
  if (window.renderEngine && window.parsedMatrix && window.spriteMap) {
    try {
      // Reset render engine (this clears all sprites including player)
      window.renderEngine.reset();
      
      // Re-render the level
      await window.renderEngine.renderMatrix(
        window.parsedMatrix,
        window.spriteMap
      );

      // Re-render the player sprite
      await window.renderEngine.renderPlayer(window.player);
      
      // 6. Reset Camera AFTER player sprite is recreated
      if (window.cameraManager) {
        window.cameraManager.reset(window.player);
      }
      
    } catch (error) {
      console.error("Error during game restart rendering:", error);
    }
  } else {
    console.error(
      "Cannot re-render during restart: Missing renderEngine, matrix, or spriteMap."
    );
  }

  console.log("Game restart complete.");
  
  // RESUME the game loop now that everything is recreated
  gameLoop.resume();
}

function togglePause(): void {
  window.isPaused = !window.isPaused;
  const pauseMenu = document.getElementById("pauseMenu") as HTMLElement;
  pauseMenu.style.display = window.isPaused ? "block" : "none";

  // Update pause button text
  const pauseButton = document.querySelector(
    '#pauseMenu button[onclick="window.togglePause()"]'
  ) as HTMLButtonElement;
  if (pauseButton) {
    pauseButton.textContent = window.isPaused ? "Resume" : "Pause";
  }
  const mainPauseButton = document.querySelector(
    '.controls button[onclick="window.togglePause()"]'
  ) as HTMLButtonElement;
  if (mainPauseButton) {
    mainPauseButton.textContent = window.isPaused ? "Resume" : "Pause";
  }

  // Use the unified game loop for pause/resume
  if (window.isPaused) {
    gameLoop.pause();
  } else {
    gameLoop.resume();
  }

  // Pause/Resume the background music
  if (window.audioManager) {
    if (window.isPaused) {
      // Explicitly call pauseBackgroundMusic which will save the current time
      window.audioManager.pauseBackgroundMusic();
    } else {
      // This will resume from the saved time
      window.audioManager.playBackgroundMusic();
    }
  }
}

function toggleMute(): void {
  // Make sure audioManager exists
  if (!window.audioManager) return;

  // Toggle the mute state using the AudioManager method
  window.audioManager.toggleMute();

  // Log the current state for debugging
  verbose(
    "gameTest",
    `Audio mute state toggled to: ${
      window.audioManager.isMuted ? "muted" : "unmuted"
    }`
  );

  // Update the text on both mute buttons
  const buttonText = window.audioManager.isMuted ? "Unmute" : "Mute";

  const pauseMenuButton = document.querySelector(
    '#pauseMenu button[onclick="window.toggleMute()"]'
  ) as HTMLButtonElement;
  if (pauseMenuButton) {
    pauseMenuButton.textContent = buttonText;
  }

  const controlsButton = document.querySelector(
    '.controls button[onclick="window.toggleMute()"]'
  ) as HTMLButtonElement;
  if (controlsButton) {
    controlsButton.textContent = buttonText;
  }

  // Let AudioManager handle the actual pausing/playing based on mute state
  if (!window.audioManager.isMuted && !window.isPaused) {
    // If unmuted and game is not paused, ensure music plays
    window.audioManager.playBackgroundMusic();
  } else if (window.audioManager.isMuted) {
    // If muted, ensure music is paused (AudioManager's toggleMute should handle this)
    window.audioManager.pauseBackgroundMusic(); // Ensure it's paused when muted
  }
}

window.togglePause = togglePause;
window.toggleMute = toggleMute;
window.restartGame = restartGame;
window.initializeGameFromMatrix = initializeGameFromMatrix;
window.updateGameMatrix = updateGameMatrix; // Expose update function
window.handleApplyMatrixClick = handleApplyMatrixClick; // Expose button handler

window.startLevel = async function startLevel(): Promise<void> {
  if (window.gameStarted) {
    return;
  }

  try {
    // Initialize audio if not already initialized
    if (!window.audioManager.isInitialized) {
      await window.audioManager.initialize(
        "../assets/Sound/Level Soundtracks/level1"
      );
    }

    // Start background music
    window.audioManager.playBackgroundMusic();

    // Initialize game if not already initialized
    if (!window.pixiInitialized) {
      await initPixi();
    }

    // Parse and render initial level
    await initializeGameFromMatrix();

    // Mark game as started
    window.gameStarted = true;

    enableControlButtons();
  } catch (err) {
    error("combinedTest", "Failed to start level:", err);
    setMatrixOutput(`Error starting level: ${getErrorMessage(err)}`);
  }
};

initPixi();

document.body.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === " ") {
    e.preventDefault();
  }
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  verbose("combinedTest", "Key down:", e.key);
  window.keys[e.key] = true;

  // Prevent scrolling for game control keys
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)
  ) {
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e: KeyboardEvent) => {
  verbose("combinedTest", "Key up:", e.key);
  window.keys[e.key] = false;
});

const matrixInputElement = document.getElementById(
  "matrixInput"
) as HTMLTextAreaElement | null;
if (matrixInputElement) {
  matrixInputElement.addEventListener("input", () => {
    const applyButton = document.getElementById(
      "applyMatrixButton"
    ) as HTMLButtonElement | null;
    if (applyButton) applyButton.disabled = false;
  });
}

// Add game over screen toggle function
window.toggleAutoRestart = function (checked: boolean): void {
  window.autoRestart = checked;
  const checkbox = document.getElementById("autoRestart") as HTMLInputElement;
  checkbox.checked = checked;
};

// Add game over handler function
window.handleGameOver = async function (action: string): Promise<void> {
  // Hide the game over screen
  const gameOverScreen = document.getElementById(
    "gameOverScreen"
  ) as HTMLElement;
  if (gameOverScreen) {
    gameOverScreen.style.display = "none";
  }

  // Unpause the game and all components
  window.isPaused = false;
  if (window.renderEngine) {
    window.renderEngine.isPaused = false;
  }
  if (window.audioManager) {
    window.audioManager.playBackgroundMusic();
  }
  if (window.physicsEngine) {
    window.physicsEngine.isPaused = false;
  }
  window.particleSystem?.resume();

  if (action === "restart") {
    await restartGame();
  } else if (action === "menu") {
    // Add your menu navigation logic here
    console.log("Returning to menu");
  }
};

// Add toggle pause function
window.togglePause = function (): void {
  const isPaused = window.isPaused;
  window.isPaused = !isPaused;

  // Show/hide pause menu
  const pauseMenu = document.getElementById("pauseMenu") as HTMLElement;
  if (pauseMenu) {
    pauseMenu.style.display = window.isPaused ? "block" : "none";
  }

  // Use the unified game loop for pause/resume
  if (window.isPaused) {
    gameLoop.pause();
  } else {
    gameLoop.resume();
  }

  // Update audio state
  if (window.audioManager) {
    if (window.isPaused) {
      window.audioManager.pauseBackgroundMusic();
    } else {
      window.audioManager.playBackgroundMusic();
    }
  }

  // Update particle system pause state
  if (window.particleSystem) {
    if (window.isPaused) {
      window.particleSystem.pause();
    } else {
      window.particleSystem.resume();
    }
  }
};

// Add music behavior toggle functions
window.toggleMusicOnDeath = function (checked: boolean): void {
  if (window.audioManager) {
    window.audioManager.restartMusicOnDeath = checked;
    const checkbox = document.getElementById(
      "restartOnDeath"
    ) as HTMLInputElement;
    checkbox.checked = checked;
  }
};

window.toggleMusicOnCompletion = function (checked: boolean): void {
  if (window.audioManager) {
    window.audioManager.restartMusicOnCompletion = checked;
    const checkbox = document.getElementById(
      "restartOnCompletion"
    ) as HTMLInputElement;
    checkbox.checked = checked;
  }
};

// Initialize toggle states when audioManager is available
if (typeof window.audioManager !== "undefined" && window.audioManager) {
  const deathCheckbox = document.getElementById(
    "restartOnDeath"
  ) as HTMLInputElement;
  const completionCheckbox = document.getElementById(
    "restartOnCompletion"
  ) as HTMLInputElement;

  if (deathCheckbox)
    deathCheckbox.checked = window.audioManager.restartMusicOnDeath;
  if (completionCheckbox)
    completionCheckbox.checked = window.audioManager.restartMusicOnCompletion;
}
