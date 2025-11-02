import { Application } from "pixi.js";
import AudioManager from "../Modules/audioManager";
import CameraManager from "../Modules/cameraManager";
import MusicSync from "../Modules/musicSync";
import { PhysicsEngine, Player } from "../Modules/physicsEngine";
import { RenderEngine } from "../Modules/renderEngine";
import { ParticleSystem } from "../Modules/visualEffectsEngine";
import type { SpriteMap } from "../Modules/spriteManager";

declare global {
  interface Window {
    audioManager: AudioManager;
    autoRestart: boolean;
    pixiApp: Application | null;
    spriteMap: SpriteMap | null;
    renderEngine: RenderEngine | null;
    physicsEngine: PhysicsEngine | null;
    player: Player | null;
    parsedMatrix: any[][] | null; // Matrix is a 2D array, adjust type if more specific
    particleSystem: ParticleSystem | null;
    musicSync: MusicSync | null;
    cameraManager: CameraManager | null;
    score: number;
    isPaused: boolean;
    keys: Record<string, boolean>;
    blockSize: number;
    pixiInitialized: boolean;
    gameStarted: boolean;
    isInitializing: boolean;
    togglePause: () => void;
    toggleMute: () => void;
    restartGame: () => Promise<void>;
    initializeGameFromMatrix: () => Promise<void>;
    updateGameMatrix: () => Promise<void>;
    handleApplyMatrixClick: () => Promise<void>;
    startLevel: () => Promise<void>;
    toggleAutoRestart: (checked: boolean) => void;
    handleGameOver: (action: string) => Promise<void>;
    toggleMusicOnDeath: (checked: boolean) => void;
    toggleMusicOnCompletion: (checked: boolean) => void;
  }
}
