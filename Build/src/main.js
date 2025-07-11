
import { log, warn, error, debug, verbose, setLogLevel } from './Modules/logManager.js';
import AudioManager from './Modules/audioManager.js';
import { MatrixParser } from './Modules/matrixParser.js';
import { Player, PhysicsEngine } from './Modules/physicsEngine.js';
import { getTeleportTarget } from './Modules/teleporterEngine.js';
import { isObjectActive, setRenderEngine } from './Modules/groupManager.js';
import { loadSprites } from './Modules/spriteManager.js';
import { RenderEngine } from './Modules/renderEngine.js';
import { ParticleSystem } from './Modules/visualEffectsEngine.js';
import { pregenerateTextures } from './Modules/animationEngine.js';
import CameraManager from './Modules/cameraManager.js';
import { MusicSync } from './Modules/musicSync.js';
import { Application, WebGLRenderer, VERSION } from 'pixi.js';

// Create global instances
window.audioManager = new AudioManager();
window.autoRestart = true; // Default to auto restart

// Now we can set the log level after importing it
setLogLevel('debug');

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
window.isInitializing = false; // Default to auto restart
let isInitializing = false;

let pixiApp = null;

async function initPixi() {
  if (isInitializing) {
    warn('combinedTest', 'Initialization already in progress, skipping...');
    return;
  }

  isInitializing = true;
  try {
    // Create PIXI Application
    if (!pixiApp) {
      pixiApp = new Application();
      await pixiApp.init({
        canvas: document.getElementById('levelCanvas'),
        width: 512,
        height: 256,
        backgroundColor: 0x222222,
        antialias: true,
        autoStart: true,
      });
    }

    // Assign globally
    window.pixiApp = pixiApp;

    verbose('combinedTest', 'PixiJS version:', VERSION || 'unknown');
    debug('combinedTest', 'Renderer type:', pixiApp.renderer instanceof WebGLRenderer ? 'WebGL' : 'Canvas');
    
    // Load sprite assets if not already loaded
    if (!spriteMap) {
        spriteMap = await loadSprites('../assets/Sprites');
    }

    if (spriteMap.has('floor')) {
        verbose('initPixi', "Found 'floor.svg' data in spriteMap.");
    } else {
        warn('initPixi', "Could not find 'floor.svg' data in spriteMap to map to type 'floor'. Ensure Sprites/floor.svg exists.");
    }

    // Create RenderEngine if not already created
    if (!renderEngine) {
        renderEngine = new RenderEngine(pixiApp, blockSize);
        setRenderEngine(renderEngine);
        // Get the particle system from renderEngine
        particleSystem = renderEngine.particleSystem;
    }

    // Initialize audio if not already initialized
    if (!audioManager.initialized) {
        await audioManager.initialize('../assets/Sound/Level Soundtracks/level1');
    }

    // Initialize musicSync if not already initialized
    if (!musicSync) {
        musicSync = new MusicSync(audioManager);
    }

    debug('combinedTest', 'PixiJS initialized, sprites loaded');
    pixiInitialized = true;

    // Enable controls
    document.querySelectorAll('.controls button').forEach(button => button.disabled = false);

    } catch (err) {
    error('combinedTest', 'PixiJS initialization failed:', err);
    document.getElementById('matrixOutput').value = `Error: ${err.message}`;
    throw err;
    } finally {
    isInitializing = false;
    }
}

async function initializeGameFromMatrix() {
    if (isInitializing) {
    warn('gameTest', 'Initialization already in progress, skipping...');
    return;
    }

    isInitializing = true;
    try {
    debug('gameTest', 'Initializing game from matrix...');
    const matrixInput = document.getElementById('matrixInput').value;
    const parsed = MatrixParser.parse(JSON.parse(matrixInput));
    parsedMatrix = parsed;

    // Only initialize player and physics engine if they don't exist
    if (!player) {
        player = new Player(0, 3, parsedMatrix.length);
    }
    if (!physicsEngine) {
        // Create camera manager first if it doesn't exist
        if (!cameraManager) {
        cameraManager = new CameraManager(
            renderEngine.container,
            parsedMatrix[0].length * blockSize, // level width
            (parsedMatrix.length + 1) * blockSize, // level height (add 1 for floor)
            pixiApp.canvas.width,
            pixiApp.canvas.height
        );
        window.cameraManager = cameraManager;
        }

        // Create physics engine with camera manager
        physicsEngine = new PhysicsEngine(parsedMatrix, player, renderEngine, audioManager, cameraManager);
    } else {
        // Update existing physics engine with new matrix
        physicsEngine.updateMatrix(parsedMatrix);

        // Update camera manager if it exists
        if (cameraManager) {
        cameraManager.setBounds(
            0,
            parsedMatrix[0].length * blockSize,
            0,
            (parsedMatrix.length + 1) * blockSize
        );
        }
    }

    // Initialize render engine if not already initialized
    if (renderEngine) {
        renderEngine.matrix = parsedMatrix;
        renderEngine.spriteMap = spriteMap;
        renderEngine.blockSprites = []; // Clear existing sprites
        await renderEngine.renderMatrix(parsedMatrix, spriteMap);

        // Only render floor if it doesn't exist
        if (!renderEngine.floorSprite || !renderEngine.floorSprite.parent) {
        debug('gameTest', 'Floor sprite not found, rendering floor...');
        renderEngine.renderFloor();
        }

        // Only render player if it doesn't exist
        if (!renderEngine.playerSprite) {
        renderEngine.renderPlayer(player);
        }

        // Camera manager is now initialized earlier with physics engine
        if (cameraManager) {
        // Position initial camera view to show floor at bottom
        const floorY = parsedMatrix.length * blockSize;
        cameraManager.setPosition(0, Math.max(0, floorY - pixiApp.canvas.height + blockSize));

        // Update camera position in render loop to follow player
        const originalTickerCallback = renderEngine.tickerCallback;
        renderEngine.tickerCallback = (delta) => {
            originalTickerCallback(delta);

            if (cameraManager && player && typeof player.x === 'number' && typeof player.y === 'number') {
            const playerX = player.x * blockSize;
            const playerY = player.y * blockSize;
            const verticalOffset = -pixiApp.canvas.height * 0.2;
            cameraManager.follow({ x: playerX, y: playerY }, 0, verticalOffset);
            cameraManager.update();
            }
        };
        }
    }

    // Only start game loop if it hasn't been started
    if (renderEngine && !gameStarted) {
        renderEngine.startGameLoop(player, physicsEngine);
        gameStarted = true;
    }

    // Update the matrix output
    document.getElementById('matrixOutput').value = JSON.stringify(parsed, null, 2);

    } catch (err) {
    error('gameTest', 'Error initializing game:', err);
    document.getElementById('matrixOutput').value = `Error: ${err.message}`;
    } finally {
    isInitializing = false;
    }
}

async function updateGameMatrix() {
    if (!gameStarted || !physicsEngine || !renderEngine) {
    warn('gameTest', 'Cannot update matrix: game not started or engines not initialized.');
    return;
    }
    try {
    debug('gameTest', 'Updating game matrix...');
    const matrixInput = document.getElementById('matrixInput').value;
    const newParsedMatrix = MatrixParser.parse(JSON.parse(matrixInput));

    // Update engines with the new matrix (PhysicsEngine needs updateMatrix method)
    parsedMatrix = newParsedMatrix; // Update global matrix reference
    physicsEngine.updateMatrix(newParsedMatrix);
    // Re-render using the updated matrix
    await renderEngine.renderMatrix(newParsedMatrix, spriteMap);
    // Optionally, reset player position or state here if needed
    // player.resetPosition(newStartX, newStartY);
    debug('gameTest', 'Game matrix updated and re-rendered.');

    } catch (e) {
    error('gameTest', 'Error updating matrix:', e);
    }
}

async function handleApplyMatrixClick() {
    const applyButton = document.getElementById('applyMatrixButton');
    if (applyButton) applyButton.disabled = true; // Disable button immediately

    if (!gameStarted) {
    debug('gameTest', 'Game not started, initializing...');
    await initializeGameFromMatrix();
    } else {
    debug('gameTest', 'Game started, updating matrix...');
    await updateGameMatrix();
    }
}

async function restartGame() {
    console.log("Restarting game...");
    if (!pixiInitialized) {
    console.warn("Game not initialized, cannot restart.");
    return;
    }

    // Hide game over screen if visible
    const gameOverScreen = document.getElementById('gameOverScreen');
    if (gameOverScreen) {
    gameOverScreen.style.display = 'none';
    }

    // 1. Reset visual effects first
    if (renderEngine) {
    // Reset any active visual effects
    if (renderEngine.particleSystem) {
        renderEngine.particleSystem.reset();
    }
    
    // Reset camera effects
    if (cameraManager) {
        cameraManager.resetEffects();
    }
    }

    // 2. Reset Player State
    if (player) {
    player.reset();
    } else {
    console.error("Player not found during restart!");
    return; // Cannot proceed without player
    }

    // 3. Reset Render Engine (clears sprites, etc.)
    if (renderEngine) {
    renderEngine.reset();
    }

    // 4. Reset audio
    if (audioManager) {
    audioManager.pauseBackgroundMusic();
    audioManager.playBackgroundMusic();
    }
    
    if (musicSync) {
    musicSync.reset();
    }

    // 5. Reset Camera and Physics (recenters on player start)
    if (cameraManager) {
    cameraManager.reset(player); // Pass player for initial position
    }
    
    if (physicsEngine) {
    verbose('gameTest', 'Resetting physics engine...');
    physicsEngine.reset();
    }

    // 6. Re-render the current matrix and player
    if (renderEngine && parsedMatrix && spriteMap) {
    try {
        // Re-render the static parts of the level
        await renderEngine.renderMatrix(parsedMatrix, spriteMap);
        
        // Reset player sprite
        if (renderEngine.playerSprite) {
        if (renderEngine.playerSprite.parent) {
            renderEngine.playerSprite.parent.removeChild(renderEngine.playerSprite);
        }
        renderEngine.playerSprite.destroy();
        renderEngine.playerSprite = null;
        }
        await renderEngine.renderPlayer(player); // Removed spriteMap parameter since it's now stored in renderEngine
        // Restart the game loop within RenderEngine
        renderEngine.startGameLoop(player, physicsEngine);
    } catch (error) {
        console.error("Error during game restart rendering:", error);
    }
    } else {
    console.error("Cannot re-render during restart: Missing renderEngine, matrix, or spriteMap.");
    }

    console.log("Game restart complete.");
}

function togglePause() {
    isPaused = !isPaused;
    const pauseMenu = document.getElementById('pauseMenu');
    pauseMenu.style.display = isPaused ? 'block' : 'none';

    // Update pause button text
    const pauseButton = document.querySelector('#pauseMenu button[onclick="window.togglePause()"]');
    if (pauseButton) {
    pauseButton.textContent = isPaused ? 'Resume' : 'Pause';
    }
    const mainPauseButton = document.querySelector('.controls button[onclick="window.togglePause()"]');
    if (mainPauseButton) {
    mainPauseButton.textContent = isPaused ? 'Resume' : 'Pause';
    }

    // Pause/Resume the background music
    if (audioManager) {
    if (isPaused) {
        // Explicitly call pauseBackgroundMusic which will save the current time
        audioManager.pauseBackgroundMusic();
    } else {
        // This will resume from the saved time
        audioManager.playBackgroundMusic();
    }
    }
}

function toggleMute() {
    // Make sure audioManager exists
    if (!audioManager) return;

    // Toggle the mute state using the AudioManager method
    audioManager.toggleMute();

    // Log the current state for debugging
    verbose('gameTest', `Audio mute state toggled to: ${audioManager.isMuted ? 'muted' : 'unmuted'}`);

    // Update the text on both mute buttons
    const buttonText = audioManager.isMuted ? 'Unmute' : 'Mute';

    const pauseMenuButton = document.querySelector('#pauseMenu button[onclick="window.toggleMute()"]');
    if (pauseMenuButton) {
    pauseMenuButton.textContent = buttonText;
    }

    const controlsButton = document.querySelector('.controls button[onclick="window.toggleMute()"]');
    if (controlsButton) {
    controlsButton.textContent = buttonText;
    }

    // Let AudioManager handle the actual pausing/playing based on mute state
    if (!audioManager.isMuted && !isPaused) {
    // If unmuted and game is not paused, ensure music plays
    audioManager.playBackgroundMusic();
    } else if (audioManager.isMuted) {
    // If muted, ensure music is paused (AudioManager's toggleMute should handle this)
    audioManager.pauseBackgroundMusic(); // Ensure it's paused when muted
    }
}

window.togglePause = togglePause;
window.toggleMute = toggleMute;
window.restartGame = restartGame;
window.initializeGameFromMatrix = initializeGameFromMatrix;
window.updateGameMatrix = updateGameMatrix; // Expose update function
window.handleApplyMatrixClick = handleApplyMatrixClick; // Expose button handler

window.startLevel = async function startLevel() {
    if (gameStarted) {
    return;
    }

    try {
    // Initialize audio if not already initialized
    if (!audioManager.isInitialized) {
        await audioManager.initialize('../assets/Sound/Level Soundtracks/level1');
    }

    // Start background music
    audioManager.playBackgroundMusic();

    // Initialize game if not already initialized
    if (!pixiInitialized) {
        await initPixi();
    }

    // Parse and render initial level
    await initializeGameFromMatrix();

    // Mark game as started
    gameStarted = true;

    // Enable controls
    document.querySelectorAll('.controls button').forEach(button => button.disabled = false);

    } catch (err) {
    error('combinedTest', 'Failed to start level:', err);
    document.getElementById('matrixOutput').value = `Error starting level: ${err.message}`;
    }
};

initPixi();

document.body.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
    e.preventDefault();
    }
});

document.addEventListener('keydown', (e) => {
    verbose('combinedTest', 'Key down:', e.key);
    keys[e.key] = true;

    // Prevent scrolling for game control keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    verbose('combinedTest', 'Key up:', e.key);
    keys[e.key] = false;
});

document.getElementById('matrixInput').addEventListener('input', async () => {
    // Now updates happen via the button
    // if (pixiInitialized) {
    //   await initializeGameFromMatrix(); // OLD behavior 
    // }
    const applyButton = document.getElementById('applyMatrixButton');
    if (applyButton) applyButton.disabled = false; // Enable button when text changes
});

// Add game over screen toggle function
window.toggleAutoRestart = function (checked) {
    window.autoRestart = checked;
    const checkbox = document.getElementById('autoRestart');
    checkbox.checked = checked;
}

// Add game over handler function
window.handleGameOver = async function (action) {
    // Hide the game over screen
    const gameOverScreen = document.getElementById('gameOverScreen');
    if (gameOverScreen) {
    gameOverScreen.style.display = 'none';
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
    if (window.particleSystem) {
    window.particleSystem.isPaused = false;
    }

    if (action === 'restart') {
    await restartGame();
    } else if (action === 'menu') {
    // Add your menu navigation logic here
    console.log('Returning to menu');
    }
}

// Add toggle pause function
window.togglePause = function () {
    const isPaused = window.isPaused;
    window.isPaused = !isPaused;

    // Show/hide pause menu
    const pauseMenu = document.getElementById('pauseMenu');
    if (pauseMenu) {
    pauseMenu.style.display = window.isPaused ? 'block' : 'none';
    }

    // Update render engine pause state
    if (window.renderEngine) {
    window.renderEngine.isPaused = window.isPaused;
    }

    // Update audio state
    if (window.audioManager) {
    if (window.isPaused) {
        window.audioManager.pauseBackgroundMusic();
    } else {
        window.audioManager.playBackgroundMusic();
    }
    }

    // Update physics engine pause state
    if (window.physicsEngine) {
    window.physicsEngine.isPaused = window.isPaused;
    }

    // Update particle system pause state
    if (window.particleSystem) {
    window.particleSystem.isPaused = window.isPaused;
    }
}

// Add music behavior toggle functions
window.toggleMusicOnDeath = function (checked) {
    if (audioManager) {
    audioManager.restartMusicOnDeath = checked;
    const checkbox = document.getElementById('restartOnDeath');
    checkbox.checked = checked;
    }
}

window.toggleMusicOnCompletion = function (checked) {
    if (audioManager) {
    audioManager.restartMusicOnCompletion = checked;
    const checkbox = document.getElementById('restartOnCompletion');
    checkbox.checked = checked;
    }
}

// Initialize toggle states when audioManager is available
if (typeof audioManager !== 'undefined' && audioManager) {
    const deathCheckbox = document.getElementById('restartOnDeath');
    const completionCheckbox = document.getElementById('restartOnCompletion');

    if (deathCheckbox) deathCheckbox.checked = audioManager.restartMusicOnDeath;
    if (completionCheckbox) completionCheckbox.checked = audioManager.restartMusicOnCompletion;
}