import { log, warn, error, debug, verbose, setLogLevel } from './Modules/logManager';
import AudioManager from './Modules/audioManager';
import { MatrixParser } from './Modules/matrixParser';
import { Player, PhysicsEngine } from './Modules/physicsEngine';
import { getTeleportTarget } from './Modules/teleporterEngine';
import { isObjectActive, setRenderEngine } from './Modules/groupManager';
import { loadSprites } from './Modules/spriteManager';
import { RenderEngine } from './Modules/renderEngine';
import { ParticleSystem } from './Modules/visualEffectsEngine';
import { pregenerateTextures } from './Modules/animationEngine';
import CameraManager from './Modules/cameraManager';
import musicSync, { MusicSync } from './Modules/musicSync';
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
window.isInitializing = false;

async function initPixi(): Promise<void> {
    if (window.isInitializing) {
        warn('combinedTest', 'Initialization already in progress, skipping...');
        return;
    }

    window.isInitializing = true;
    try {
        // Create PIXI Application
        if (!window.pixiApp) {
            window.pixiApp = new Application();
            if (!window.pixiApp) return;
            await window.pixiApp.init({
                canvas: document.getElementById('levelCanvas') as HTMLCanvasElement,
                width: 512,
                height: 256,
                backgroundColor: 0x222222,
                antialias: true,
                autoStart: true,
                useBackBuffer: true,
            });
        }

        verbose('combinedTest', 'PixiJS version:', VERSION || 'unknown');
        debug('combinedTest', 'Renderer type:', window.pixiApp.renderer instanceof WebGLRenderer ? 'WebGL' : 'Canvas');

        // Load sprite assets if not already loaded
        if (!window.spriteMap) {
            window.spriteMap = await loadSprites('assets/Sprites');
        }

        if (window.spriteMap.has('floor')) {
            verbose('initPixi', "Found 'floor.svg' data in spriteMap.");
        } else {
            warn('initPixi', "Could not find 'floor.svg' data in spriteMap to map to type 'floor'. Ensure Sprites/floor.svg exists.");
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
        if (!window.audioManager.initialized) {
            await window.audioManager.initialize('../assets/Sound/Level Soundtracks/level1');
        }

        // Initialize musicSync if not already initialized
        if (!window.musicSync) {
            window.musicSync = new MusicSync(window.audioManager);
        }

        debug('combinedTest', 'PixiJS initialized, sprites loaded');
        window.pixiInitialized = true;

        // Enable controls
        document.querySelectorAll('.controls button').forEach((button: HTMLButtonElement) => button.disabled = false);

    } catch (err) {
        error('combinedTest', 'PixiJS initialization failed:', err);
        document.getElementById('matrixOutput').value = `Error: ${err.message}`;
        throw err;
    } finally {
        window.isInitializing = false;
    }
}

async function initializeGameFromMatrix(): Promise<void> {
    if (window.isInitializing) {
        warn('gameTest', 'Initialization already in progress, skipping...');
        return;
    }

    window.isInitializing = true;
    try {
        debug('gameTest', 'Initializing game from matrix...');
        const matrixInput = document.getElementById('matrixInput') as HTMLTextAreaElement;
        const parsed = MatrixParser.parse(JSON.parse(matrixInput.value));
        window.parsedMatrix = parsed;

        // Initialize render engine if not already initialized
        if (window.renderEngine) {
            window.renderEngine.matrix = window.parsedMatrix;
            window.renderEngine.spriteMap = window.spriteMap;
            window.renderEngine.blockSprites = []; // Clear existing sprites
            await window.renderEngine.renderMatrix(window.parsedMatrix, window.spriteMap);

            // Only render floor if it doesn't exist
            if (!window.renderEngine.floorSprite || !window.renderEngine.floorSprite.parent) {
                debug('gameTest', 'Floor sprite not found, rendering floor...');
                window.renderEngine.renderFloor();
            }

            // Camera manager is now initialized earlier with physics engine
            if (window.cameraManager) {
                // Position initial camera view to show floor at bottom
                const floorY = window.parsedMatrix.length * window.blockSize;
                window.cameraManager.setPosition(0, Math.max(0, floorY - window.pixiApp!.canvas.height + window.blockSize));

                // Update camera position in render loop to follow player
                const originalTickerCallback = window.renderEngine.tickerCallback;
                window.renderEngine.tickerCallback = (delta: number) => {
                    originalTickerCallback(delta);

                    if (window.cameraManager && window.player && typeof window.player.x === 'number' && typeof window.player.y === 'number') {
                        const playerX = window.player.x * window.blockSize;
                        const playerY = window.player.y * window.blockSize;
                        const verticalOffset = -window.pixiApp!.canvas.height * 0.2;
                        window.cameraManager.follow({ x: playerX, y: playerY }, 0, verticalOffset);
                        window.cameraManager.update();
                    }
                };
            }
        }

        // Create camera manager first if it doesn't exist
        if (!window.cameraManager) {
            window.cameraManager = new CameraManager(
                window.renderEngine!.container,
                window.parsedMatrix[0].length * window.blockSize, // level width
                (window.parsedMatrix.length + 1) * window.blockSize, // level height (add 1 for floor)
                window.pixiApp!.canvas.width,
                window.pixiApp!.canvas.height
            );
            window.cameraManager = window.cameraManager;
        }

        // Only initialize physics engine if it doesn't exist
        if (!window.physicsEngine) {
            // Create physics engine with camera manager
            window.physicsEngine = new PhysicsEngine(window.parsedMatrix, window.player, window.renderEngine, window.audioManager, window.cameraManager);
        } else {
            // Update existing physics engine with new matrix
            window.physicsEngine.updateMatrix(window.parsedMatrix);

            // Update camera manager if it exists
            if (window.cameraManager) {
                window.cameraManager.setBounds(
                    0,
                    window.parsedMatrix[0].length * window.blockSize,
                    0,
                    (window.parsedMatrix.length + 1) * window.blockSize
                );
            }
        }

        // Only initialize player if it doesn't exist
        if (!window.player) {
            // Start the player at the bottom left of the level
            const startX = 1; // One block in from the left
            const startY = window.parsedMatrix.length - 2; // Two blocks up from the bottom
            debug('gameTest', `Creating player at (${startX}, ${startY}) in level ${window.parsedMatrix[0].length}x${window.parsedMatrix.length}`);
            window.player = new Player(startX, startY, window.parsedMatrix[0].length, window.parsedMatrix.length, window.physicsEngine);
            window.player.renderEngine = window.renderEngine;
        }

        if (window.physicsEngine && !window.renderEngine!.playerSprite) {
            window.renderEngine!.renderPlayer(window.player);
        }

        // Only start game loop if it hasn't been started
        if (window.renderEngine && !window.gameStarted) {
            window.renderEngine.startGameLoop(window.player, window.physicsEngine);
            window.gameStarted = true;
        }

        // Update the matrix output
        (document.getElementById('matrixOutput') as HTMLTextAreaElement).value = JSON.stringify(parsed, null, 2);

    } catch (err) {
        error('gameTest', 'Error initializing game:', err);
        (document.getElementById('matrixOutput') as HTMLTextAreaElement).value = `Error: ${err.message}`;
    } finally {
        window.isInitializing = false;
    }
}

async function updateGameMatrix(): Promise<void> {
    if (!window.gameStarted || !window.physicsEngine || !window.renderEngine) {
        warn('gameTest', 'Cannot update matrix: game not started or engines not initialized.');
        return;
    }
    try {
        debug('gameTest', 'Updating game matrix...');
        const matrixInput = document.getElementById('matrixInput') as HTMLTextAreaElement;
        const newParsedMatrix = MatrixParser.parse(JSON.parse(matrixInput.value));

        // Update engines with the new matrix (PhysicsEngine needs updateMatrix method)
        window.parsedMatrix = newParsedMatrix; // Update global matrix reference
        window.physicsEngine.updateMatrix(newParsedMatrix);
        // Re-render using the updated matrix
        await window.renderEngine!.renderMatrix(newParsedMatrix, window.spriteMap);
        // Optionally, reset player position or state here if needed
        // player.resetPosition(newStartX, newStartY);
        debug('gameTest', 'Game matrix updated and re-rendered.');

    } catch (e) {
        error('gameTest', 'Error updating matrix:', e);
    }
}

async function handleApplyMatrixClick(): Promise<void> {
    const applyButton = document.getElementById('applyMatrixButton') as HTMLButtonElement;
    if (applyButton) applyButton.disabled = true; // Disable button immediately

    if (!window.gameStarted) {
        debug('gameTest', 'Game not started, initializing...');
        await initializeGameFromMatrix();
    } else {
        debug('gameTest', 'Game started, updating matrix...');
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
    const gameOverScreen = document.getElementById('gameOverScreen') as HTMLElement;
    if (gameOverScreen) {
        gameOverScreen.style.display = 'none';
    }

    // 1. Reset visual effects first
    if (window.renderEngine) {
        // Reset any active visual effects
        if (window.renderEngine.particleSystem) {
            window.renderEngine.particleSystem.reset();
        }

        // Reset camera effects
        if (window.cameraManager) {
            window.cameraManager.resetEffects();
        }
    }

    // 2. Reset Player State
    if (window.player) {
        window.player.reset();
    } else {
        console.error("Player not found during restart!");
        return; // Cannot proceed without player
    }

    // 3. Reset Render Engine (clears sprites, etc.)
    if (window.renderEngine) {
        window.renderEngine.reset();
    }

    // 4. Reset audio
    if (window.audioManager) {
        window.audioManager.pauseBackgroundMusic();
        window.audioManager.playBackgroundMusic();
    }

    if (window.musicSync) {
        window.musicSync.reset();
    }

    // 5. Reset Camera and Physics (recenters on player start)
    if (window.cameraManager) {
        window.cameraManager.reset(window.player); // Pass player for initial position
    }

    if (window.physicsEngine) {
        verbose('gameTest', 'Resetting physics engine...');
        window.physicsEngine.reset();
    }

    // 6. Re-render the current matrix and player
    if (window.renderEngine && window.parsedMatrix && window.spriteMap) {
        try {
            // Re-render the static parts of the level
            await window.renderEngine.renderMatrix(window.parsedMatrix, window.spriteMap);

            // Reset player sprite
            if (window.renderEngine.playerSprite) {
                if (window.renderEngine.playerSprite.parent) {
                    window.renderEngine.playerSprite.parent.removeChild(window.renderEngine.playerSprite);
                }
                window.renderEngine.playerSprite.destroy();
                window.renderEngine.playerSprite = null;
            }
            await window.renderEngine.renderPlayer(window.player); // Removed spriteMap parameter since it's now stored in renderEngine
            // Restart the game loop within RenderEngine
            window.renderEngine.startGameLoop(window.player, window.physicsEngine);
        } catch (error) {
            console.error("Error during game restart rendering:", error);
        }
    } else {
        console.error("Cannot re-render during restart: Missing renderEngine, matrix, or spriteMap.");
    }

    console.log("Game restart complete.");
}

function togglePause(): void {
    window.isPaused = !window.isPaused;
    const pauseMenu = document.getElementById('pauseMenu') as HTMLElement;
    pauseMenu.style.display = window.isPaused ? 'block' : 'none';

    // Update pause button text
    const pauseButton = document.querySelector('#pauseMenu button[onclick="window.togglePause()"]') as HTMLButtonElement;
    if (pauseButton) {
        pauseButton.textContent = window.isPaused ? 'Resume' : 'Pause';
    }
    const mainPauseButton = document.querySelector('.controls button[onclick="window.togglePause()"]') as HTMLButtonElement;
    if (mainPauseButton) {
        mainPauseButton.textContent = window.isPaused ? 'Resume' : 'Pause';
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
    verbose('gameTest', `Audio mute state toggled to: ${window.audioManager.isMuted ? 'muted' : 'unmuted'}`);

    // Update the text on both mute buttons
    const buttonText = window.audioManager.isMuted ? 'Unmute' : 'Mute';

    const pauseMenuButton = document.querySelector('#pauseMenu button[onclick="window.toggleMute()"]') as HTMLButtonElement;
    if (pauseMenuButton) {
        pauseMenuButton.textContent = buttonText;
    }

    const controlsButton = document.querySelector('.controls button[onclick="window.toggleMute()"]') as HTMLButtonElement;
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
            await window.audioManager.initialize('../assets/Sound/Level Soundtracks/level1');
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

        // Enable controls
        document.querySelectorAll('.controls button').forEach((button: HTMLButtonElement) => button.disabled = false);

    } catch (err) {
        error('combinedTest', 'Failed to start level:', err);
        (document.getElementById('matrixOutput') as HTMLTextAreaElement).value = `Error starting level: ${err.message}`;
    }
};

initPixi();

document.body.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === ' ') {
        e.preventDefault();
    }
});

document.addEventListener('keydown', (e: KeyboardEvent) => {
    verbose('combinedTest', 'Key down:', e.key);
    window.keys[e.key] = true;

    // Prevent scrolling for game control keys
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e: KeyboardEvent) => {
    verbose('combinedTest', 'Key up:', e.key);
    window.keys[e.key] = false;
});

document.getElementById('matrixInput').addEventListener('input', async () => {
    // Now updates happen via the button
    // if (pixiInitialized) {
    //   await initializeGameFromMatrix(); // OLD behavior 
    // }
    const applyButton = document.getElementById('applyMatrixButton') as HTMLButtonElement;
    if (applyButton) applyButton.disabled = false; // Enable button when text changes
});

// Add game over screen toggle function
window.toggleAutoRestart = function (checked: boolean): void {
    window.autoRestart = checked;
    const checkbox = document.getElementById('autoRestart') as HTMLInputElement;
    checkbox.checked = checked;
}

// Add game over handler function
window.handleGameOver = async function (action: string): Promise<void> {
    // Hide the game over screen
    const gameOverScreen = document.getElementById('gameOverScreen') as HTMLElement;
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
window.togglePause = function (): void {
    const isPaused = window.isPaused;
    window.isPaused = !isPaused;

    // Show/hide pause menu
    const pauseMenu = document.getElementById('pauseMenu') as HTMLElement;
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
window.toggleMusicOnDeath = function (checked: boolean): void {
    if (window.audioManager) {
        window.audioManager.restartMusicOnDeath = checked;
        const checkbox = document.getElementById('restartOnDeath') as HTMLInputElement;
        checkbox.checked = checked;
    }
}

window.toggleMusicOnCompletion = function (checked: boolean): void {
    if (window.audioManager) {
        window.audioManager.restartMusicOnCompletion = checked;
        const checkbox = document.getElementById('restartOnCompletion') as HTMLInputElement;
        checkbox.checked = checked;
    }
}

// Initialize toggle states when audioManager is available
if (typeof window.audioManager !== 'undefined' && window.audioManager) {
    const deathCheckbox = document.getElementById('restartOnDeath') as HTMLInputElement;
    const completionCheckbox = document.getElementById('restartOnCompletion') as HTMLInputElement;

    if (deathCheckbox) deathCheckbox.checked = window.audioManager.restartMusicOnDeath;
    if (completionCheckbox) completionCheckbox.checked = window.audioManager.restartMusicOnCompletion;
}