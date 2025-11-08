import { timeManager } from "./timeManager";
import { debug, verbose } from "./logManager";
import type { PhysicsEngine } from "./physicsEngine";
import type { RenderEngine } from "./renderEngine";
import type CameraManager from "./cameraManager";

interface GameLoopSystems {
  physics: PhysicsEngine;
  renderer: RenderEngine;
  camera: CameraManager;
}

export class GameLoop {
  private systems: GameLoopSystems | null = null;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  
  // Performance monitoring
  private frameCount: number = 0;
  private fpsUpdateInterval: number = 1000; // Update FPS display every second
  private lastFpsUpdate: number = 0;
  private currentFPS: number = 0;
  
  constructor() {
    debug("GameLoop", "Game loop created");
  }

  /**
   * Register all game systems that need to be updated
   */
  registerSystems(systems: GameLoopSystems): void {
    this.systems = systems;
    debug("GameLoop", "Systems registered:", {
      physics: !!systems.physics,
      renderer: !!systems.renderer,
      camera: !!systems.camera,
    });
  }

  /**
   * Start the game loop
   */
  start(): void {
    if (this.isRunning) {
      debug("GameLoop", "Already running, ignoring start");
      return;
    }

    if (!this.systems) {
      throw new Error("Cannot start game loop: systems not registered");
    }

    this.isRunning = true;
    this.isPaused = false;
    this.lastFrameTime = performance.now();
    this.lastFpsUpdate = this.lastFrameTime;
    
    debug("GameLoop", "Starting game loop");
    this.loop();
  }

  /**
   * The main game loop - runs every frame
   */
  private loop = (): void => {
    if (!this.isRunning) {
      return;
    }

    // Request next frame FIRST to ensure consistent timing
    this.animationFrameId = requestAnimationFrame(this.loop);

    // Get current time
    const currentTime = performance.now();
    
    // Calculate delta time using timeManager (handles time scaling, pause, etc.)
    const deltaTimeSeconds = timeManager.update(currentTime);
    const deltaTimeMs = deltaTimeSeconds * 1000;

    // Skip update if paused (timeManager will return 0 delta when paused)
    if (this.isPaused || deltaTimeSeconds === 0) {
      return;
    }

    // Update FPS counter
    this.updateFPS(currentTime);

    // Update all systems in the correct order
    this.updateSystems(deltaTimeMs);

    this.lastFrameTime = currentTime;
    this.frameCount++;
  };

  /**
   * Update all game systems in the correct order
   */
  private updateSystems(deltaTimeMs: number): void {
    if (!this.systems) return;

    verbose("GameLoop", `Frame update: deltaTime=${deltaTimeMs.toFixed(2)}ms`);

    // 1. Physics - update game state
    if (this.systems.physics && !this.systems.physics.isPaused) {
      this.systems.physics.update(deltaTimeMs);
    }

    // 2. Update player visual position based on physics
    if (this.systems.renderer && this.systems.physics) {
      const player = (this.systems.physics as any).player;
      if (player) {
        this.systems.renderer.updatePlayerPosition(player, player.rotation);
      }
    }

    // 3. Camera - follow player position (if camera exists)
    if (this.systems.camera && this.systems.physics && this.systems.renderer) {
      try {
        const player = (this.systems.physics as any).player;
        if (player) {
          const blockSize = this.systems.renderer.blockSize || 32;
          const playerX = player.x * blockSize;
          const playerY = player.y * blockSize;
          
          // Get canvas height for offset calculation
          const canvasHeight = (this.systems.renderer as any)?.pixiApp?.canvas?.height || 256;
          
          this.systems.camera.follow(
            { x: playerX, y: playerY },
            0,
            -canvasHeight * 0.2
          );
          this.systems.camera.update(deltaTimeMs);
        }
      } catch (error) {
        console.error("[GameLoop] Camera update error:", error);
        // Don't let camera errors break the entire game
      }
    }

    // 4. Renderer - handle any game-logic-driven visual updates
    if (this.systems.renderer && !this.systems.renderer.isPaused) {
      this.systems.renderer.updateVisuals?.(deltaTimeMs);
    }
  }

  /**
   * Update FPS counter
   */
  private updateFPS(currentTime: number): void {
    const timeSinceLastUpdate = currentTime - this.lastFpsUpdate;
    
    if (timeSinceLastUpdate >= this.fpsUpdateInterval) {
      this.currentFPS = (this.frameCount * 1000) / timeSinceLastUpdate;
      this.frameCount = 0;
      this.lastFpsUpdate = currentTime;
      
      verbose("GameLoop", `FPS: ${this.currentFPS.toFixed(1)}`);
    }
  }

  /**
   * Pause the game loop
   */
  pause(): void {
    if (!this.isRunning) return;
    
    this.isPaused = true;
    timeManager.pause();
    
    // Pause all systems
    if (this.systems) {
      if (this.systems.physics) this.systems.physics.pause();
      if (this.systems.renderer) this.systems.renderer.setPaused(true);
    }
    
    debug("GameLoop", "Game loop paused");
  }

  /**
   * Resume the game loop
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) return;
    
    this.isPaused = false;
    timeManager.resume();
    
    // Resume all systems
    if (this.systems) {
      if (this.systems.physics) this.systems.physics.resume();
      if (this.systems.renderer) this.systems.renderer.setPaused(false);
    }
    
    // Reset timing to prevent large delta spike
    this.lastFrameTime = performance.now();
    
    debug("GameLoop", "Game loop resumed");
  }

  /**
   * Stop the game loop completely
   */
  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.isPaused = false;
    
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    debug("GameLoop", "Game loop stopped");
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.currentFPS;
  }

  /**
   * Get loop status
   */
  getStatus(): { running: boolean; paused: boolean; fps: number } {
    return {
      running: this.isRunning,
      paused: this.isPaused,
      fps: this.currentFPS,
    };
  }
}

// Export singleton instance
export const gameLoop = new GameLoop();
