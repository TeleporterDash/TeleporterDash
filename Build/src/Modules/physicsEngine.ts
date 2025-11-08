import {
  getTeleportTarget,
  TeleportMatrix,
  TeleportableObject,
} from "./teleporterEngine";
import { isObjectActive, triggerGroup, handleUnlockOrb } from "./groupManager";
import { timeManager } from "./timeManager";
import Matter, {
  Engine,
  World,
  Body,
  Bodies,
  Constraint,
  Events,
  IEventCollision,
} from "matter-js";
import { debug, verbose } from "./logManager";

const PHYSICS_CONSTANTS = {
  GRAVITY: 0.5,
  MAX_FALL_SPEED: 8,
  MOVE_SPEED: 0.1, // pixels/ms: ~3.2 blocks/sec at 32px/block
  JUMP_FORCE: -1,
  DOUBLE_JUMP_FORCE: -2,
  JUMP_BUFFER_TIME: 200,
  COYOTE_TIME: 200,
  LANE_SWITCH_DELAY: 150,
  ROTATION_SPEED: 180,
  MAX_DELTA_TIME: 16.667, // Cap at ~60 FPS (ms) to prevent large physics steps
  VELOCITY_EPSILON: 0.0001, // Minimum velocity before clamping to zero
  POSITION_EPSILON: 0.001, // Floating-point tolerance for position checks
  MAX_VELOCITY_MAGNITUDE: 50, // Hard cap on total velocity
  TELEPORT_COOLDOWN: 15, // Frames before another teleport
  GROUND_COLLISION_THRESHOLD: 0.5, // Distance to be considered "on ground"
} as const;

const BLOCK_TYPE = {
  FINISH: 4,
  TELEPORTER: 3,
  TELEPORT_START: 7,
  TELEPORT_END: 8,
  CLIPPER_MODE: 5,
  CLASSIC_MODE: 6,
  TRIGGER: 13,
  UNLOCK_ORB: 14,
  LEFT_ORB: 11,
  RIGHT_ORB: 12,
} as const;

// Player state machine for robust state tracking
enum PlayerState {
  GROUNDED = "grounded",
  JUMPING = "jumping",
  FALLING = "falling",
  DOUBLE_JUMPING = "double_jumping",
  DEAD = "dead",
  COMPLETED = "completed",
}

// Helper to clamp values safely
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

// Helper to check if a number is safe (finite and not too large)
function isSafeNumber(value: number): boolean {
  return (
    isFinite(value) &&
    Math.abs(value) < PHYSICS_CONSTANTS.MAX_VELOCITY_MAGNITUDE * 10
  );
}

const CollisionCategories = {
  PLAYER: 0x0001,
  FLOOR: 0x0002,
  BLOCK: 0x0004,
};

type LevelBlock = TeleportableObject & {
  // allow arbitrary string keys so LevelBlock is compatible with GroupObject-like shapes
  [key: string]: any;
  collision?: string;
  isModifier?: boolean;
  modifierType?: number;
  params?: any;
  transform?: { rotation?: number };
  group?: string | number;
  appearance?: any;
  x?: number;
  y?: number;
  _activated?: boolean;
};

type LevelMatrix = Array<Array<LevelBlock | null | undefined>>;

type GridCoordinate = {
  row: number;
  col: number;
};

type RenderEngineLike = {
  blockSize: number;
  particleSystem?: {
    createExplosion?: (
      pos: { x: number; y: number },
      color: string,
      count: number,
      life: number
    ) => Promise<void>;
    reset?: () => void;
  };
  isPaused?: boolean;
  updatePlayerPosition?: (
    pos: { x: number; y: number },
    angleDeg: number
  ) => void;
  showModifierActivation?: (modifier: any) => void;
};

export type AudioManagerLike = {
  playJumpSound?: () => void;
  playDeathSound?: () => void;
  playCompletionSound?: () => void;
  restartMusicOnDeath?: boolean;
  backgroundMusic?: { currentTime?: number };
  backgroundMusicTime?: number;
  isMuted?: boolean;
  pauseBackgroundMusic?: () => void;
};

type CameraManagerLike = {
  resetEffects?: () => void;
  zoomTo?: (level: number, duration: number) => void;
  shake?: (intensity: number, duration: number) => void;
  tilt?: (angle: number, direction: string, duration: number) => void;
  pan?: (offsetX: number, offsetY: number, duration: number) => void;
};

class Player {
  [x: string]: any;
  initialPos: { x: number; y: number };
  levelWidth: number;
  levelHeight: number;
  physicsEngine: PhysicsEngine | null;
  lanePositions: number[];
  mode: "classic" | "clipper";
  lane: number;
  isFreeMoving: boolean;
  teleportCooldown: number;
  score: number;
  jumpsRemaining: number;
  isJumping: boolean;
  isOnPlatform: boolean;
  doubleJumpAvailable: boolean;
  lastGroundedTime: number;
  facing: 1 | -1;
  rotation: number;
  jumpRotationDirection: 1 | -1;
  laneSwitchCooldown: number;

  // New state tracking
  state: PlayerState;
  inputBuffer: { jump: number; laneSwitch: number };
  velocityHistory: Array<{ x: number; y: number }>;
  positionHistory: Array<{ x: number; y: number }>;

  // Expose x/y to satisfy PlayerLike consumers; use playerBody position when available.
  get x(): number {
    const x = this.physicsEngine?.playerBody?.position.x ?? this.initialPos.x;
    if (!isSafeNumber(x)) {
      console.error(`[Player] Invalid X position: ${x}, resetting to initial`);
      return this.initialPos.x;
    }
    return x;
  }
  get y(): number {
    const y = this.physicsEngine?.playerBody?.position.y ?? this.initialPos.y;
    if (!isSafeNumber(y)) {
      console.error(`[Player] Invalid Y position: ${y}, resetting to initial`);
      return this.initialPos.y;
    }
    return y;
  }

  constructor(
    x: number,
    y: number,
    levelWidth: number,
    levelHeight: number,
    physicsEngine?: PhysicsEngine | null
  ) {
    // Ensure the initial position is within bounds
    this.initialPos = {
      x: clamp(x + 0.5, 0.5, levelWidth - 0.5),
      y: clamp(y + 0.5, 0.5, levelHeight - 0.5),
    };
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.physicsEngine = physicsEngine || null;
    this.lanePositions = [levelHeight / 4, levelHeight / 2, levelHeight - 0.75];
    // sensible defaults (just kidding they're not)
    this.mode = "classic";
    this.lane = 1;
    this.isFreeMoving = false;
    this.teleportCooldown = 0;
    this.score = 0;
    this.jumpsRemaining = 0;
    this.isJumping = false;
    this.isOnPlatform = false;
    this.doubleJumpAvailable = false;
    this.lastGroundedTime = Date.now();
    this.facing = 1;
    this.rotation = 0;
    this.jumpRotationDirection = 1;
    this.laneSwitchCooldown = 0;

    // Initialize new state tracking
    this.state = PlayerState.GROUNDED;
    this.inputBuffer = { jump: 0, laneSwitch: 0 };
    this.velocityHistory = [];
    this.positionHistory = [];
  }

  reset() {
    this.mode = "classic";
    this.lane = 1;
    this.isFreeMoving = false;
    this.teleportCooldown = 0;
    this.score = 0;
    this.jumpsRemaining = 0;
    this.isJumping = false;
    this.isOnPlatform = false;
    this.doubleJumpAvailable = false;
    this.lastGroundedTime = Date.now();
    this.facing = 1;
    this.rotation = 0;
    this.jumpRotationDirection = 1;
    this.laneSwitchCooldown = 0;
    this.state = PlayerState.GROUNDED;
    this.inputBuffer = { jump: 0, laneSwitch: 0 };
    this.velocityHistory = [];
    this.positionHistory = [];

    if (this.physicsEngine?.playerBody) {
      Body.setPosition(this.physicsEngine.playerBody, this.initialPos);
      Body.setVelocity(this.physicsEngine.playerBody, { x: 0, y: 0 });
      Body.setAngle(this.physicsEngine.playerBody, 0);
      Body.setAngularVelocity(this.physicsEngine.playerBody, 0);
    }
  }

  // Update player state based on physics
  updateState() {
    const body = this.physicsEngine?.playerBody;
    if (!body) return;

    const velocity = body.velocity;

    // Update state based on physics
    if (
      this.state === PlayerState.DEAD ||
      this.state === PlayerState.COMPLETED
    ) {
      return; // Terminal states
    }

    if (this.isOnPlatform) {
      this.state = PlayerState.GROUNDED;
      this.jumpsRemaining = 2;
      this.doubleJumpAvailable = true;
    } else if (velocity.y < -PHYSICS_CONSTANTS.VELOCITY_EPSILON) {
      // Moving upward
      if (this.jumpsRemaining === 0) {
        this.state = PlayerState.DOUBLE_JUMPING;
      } else {
        this.state = PlayerState.JUMPING;
      }
    } else if (velocity.y > PHYSICS_CONSTANTS.VELOCITY_EPSILON) {
      // Moving downward
      this.state = PlayerState.FALLING;
    }

    // Record history for debugging/rollback
    this.positionHistory.push({ x: body.position.x, y: body.position.y });
    this.velocityHistory.push({ x: velocity.x, y: velocity.y });

    // Keep only last 60 frames of history
    if (this.positionHistory.length > 60) {
      this.positionHistory.shift();
      this.velocityHistory.shift();
    }
  }

  jump() {
    if (this.mode !== "classic") return false;
    const body = this.physicsEngine?.playerBody;
    if (!body) return false;

    if (this.isOnPlatform) {
      // First jump
      Matter.Body.setVelocity(body, {
        x: body.velocity.x,
        y: PHYSICS_CONSTANTS.JUMP_FORCE,
      });
      this.isJumping = true;
      this.isOnPlatform = false;
      this.doubleJumpAvailable = true;
      this.jumpsRemaining = 1;
      this.state = PlayerState.JUMPING;
    } else if (this.doubleJumpAvailable) {
      // Double jump
      Matter.Body.setVelocity(body, {
        x: body.velocity.x,
        y: PHYSICS_CONSTANTS.DOUBLE_JUMP_FORCE,
      });
      this.doubleJumpAvailable = false;
      this.jumpsRemaining = 0;
      this.state = PlayerState.DOUBLE_JUMPING;
    } else {
      return false;
    }
    return true;
  }

  canJump(currentTime: number) {
    return (
      this.isOnPlatform ||
      currentTime - this.lastGroundedTime <= PHYSICS_CONSTANTS.COYOTE_TIME ||
      this.doubleJumpAvailable
    );
  }

  switchLane(direction: number) {
    if (this.mode !== "clipper" || this.laneSwitchCooldown > 0) return false;
    const newLane = Math.max(0, Math.min(2, this.lane + direction));
    if (newLane === this.lane) return false;

    this.lane = newLane;
    this.laneSwitchCooldown = PHYSICS_CONSTANTS.LANE_SWITCH_DELAY;
    if (!this.isFreeMoving) {
      const body = this.physicsEngine?.playerBody;
      if (body) {
        Body.setPosition(body, {
          x: body.position.x,
          y: this.lanePositions[this.lane],
        });
        Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      }
    }
    return true;
  }

  toggleFreeMove(start: boolean) {
    if (this.mode !== "clipper" || (this.lane !== 0 && this.lane !== 2))
      return false;
    this.isFreeMoving = start;
    const body = this.physicsEngine?.playerBody;
    if (!body) return false;
    if (start) {
      if (this.physicsEngine?.laneConstraint) {
        World.remove(
          this.physicsEngine.engine.world,
          this.physicsEngine.laneConstraint
        );
        this.physicsEngine.laneConstraint = null;
      }
    } else {
      Body.setPosition(body, {
        x: body.position.x,
        y: this.lanePositions[this.lane],
      });
      Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      this.physicsEngine!.laneConstraint = Constraint.create({
        bodyA: body,
        pointB: { x: body.position.x, y: this.lanePositions[this.lane] },
        stiffness: 1,
        length: 0,
      });
      World.add(
        this.physicsEngine!.engine.world,
        this.physicsEngine!.laneConstraint!
      );
    }
    return true;
  }

  setMode(mode: "classic" | "clipper") {
    if (mode !== "classic" && mode !== "clipper") return false;
    this.mode = mode;
    const body = this.physicsEngine?.playerBody;
    if (!body || !this.physicsEngine) return false;
    if (mode === "clipper") {
      this.lane = 1;
      Body.setPosition(body, { x: body.position.x, y: this.lanePositions[1] });
      Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      this.physicsEngine.laneConstraint = Constraint.create({
        bodyA: body,
        pointB: { x: body.position.x, y: this.lanePositions[1] },
        stiffness: 1,
        length: 0,
      });
      World.add(
        this.physicsEngine.engine.world,
        this.physicsEngine.laneConstraint
      );
      if (this.physicsEngine.groundConstraint) {
        World.remove(
          this.physicsEngine.engine.world,
          this.physicsEngine.groundConstraint
        );
        this.physicsEngine.groundConstraint = null;
      }
      Body.setStatic(body, false);
      this.physicsEngine.engine.gravity.y = 0;
    } else {
      if (this.physicsEngine.laneConstraint) {
        World.remove(
          this.physicsEngine.engine.world,
          this.physicsEngine.laneConstraint
        );
      }
      this.physicsEngine.laneConstraint = null;
      this.physicsEngine.engine.gravity.y = PHYSICS_CONSTANTS.GRAVITY;
    }
    this.rotation = 0;
    this.jumpRotationDirection = 1;
    return true;
  }

  setFacing(direction: 1 | -1) {
    if (direction !== 1 && direction !== -1) return false;
    this.facing = this.jumpRotationDirection = direction;
    return true;
  }

  update(deltaTime: number) {
    // Decay cooldowns
    this.laneSwitchCooldown = Math.max(0, this.laneSwitchCooldown - deltaTime);
    this.teleportCooldown = Math.max(0, this.teleportCooldown - deltaTime);

    // Decay input buffers
    this.inputBuffer.jump = Math.max(0, this.inputBuffer.jump - deltaTime);
    this.inputBuffer.laneSwitch = Math.max(
      0,
      this.inputBuffer.laneSwitch - deltaTime
    );

    // Update state machine
    this.updateState();

    // Handle rotation in classic mode during jump
    if (this.isJumping && this.mode === "classic") {
      this.rotation =
        (this.rotation +
          this.jumpRotationDirection *
            PHYSICS_CONSTANTS.ROTATION_SPEED *
            (deltaTime / 1000)) %
        360;
      if (this.physicsEngine?.playerBody) {
        Body.setAngle(
          this.physicsEngine.playerBody,
          (this.rotation * Math.PI) / 180
        );
      }
    } else {
      this.rotation = 0;
    }
  }

  cleanup() {
    Object.assign(this, {
      mode: "classic",
      lane: 1,
      isFreeMoving: false,
      teleportCooldown: 0,
      score: 0,
      jumpsRemaining: 2,
      isJumping: false,
      isOnPlatform: false,
      doubleJumpAvailable: true,
      lastGroundedTime: Date.now(),
      facing: 1,
      rotation: 0,
      jumpRotationDirection: 1,
    } as Partial<Player>);
  }
}

class PhysicsEngine {
  levelMatrix: LevelMatrix;
  renderEngine?: RenderEngineLike;
  audioManager?: AudioManagerLike;
  cameraManager?: CameraManagerLike;
  levelWidth: number;
  levelHeight: number;
  player: Player;
  groundLevel: number;
  engine: Engine;
  playerBody?: Body;
  floorBody?: Body;
  blockBodies: Body[];
  keys: Record<string, boolean>;
  isPaused: boolean;
  isDead: boolean;
  isComplete: boolean;
  isDying: boolean;
  lastLaneSwitchTime: number;
  lastJumpPressed: boolean;
  unlockedGroups: Set<string | number>;
  activeModifiers: Set<LevelBlock>;
  laneConstraint: Constraint | null;
  groundConstraint: Constraint | null;
  lastHazardColor?: string;
  _eventListeners: Record<string, EventListener | undefined>;

  constructor(
    levelMatrix: LevelMatrix,
    player?: Player,
    renderEngine?: RenderEngineLike,
    audioManager?: AudioManagerLike,
    cameraManager?: CameraManagerLike
  ) {
    this.levelMatrix = levelMatrix;
    this.renderEngine = renderEngine;
    this.audioManager = audioManager;
    this.cameraManager = cameraManager;
    this.levelWidth = levelMatrix[0].length;
    this.levelHeight = levelMatrix.length;
    this.player =
      player ||
      new Player(
        0,
        this.levelHeight - 1,
        this.levelWidth,
        this.levelHeight,
        this
      );
    this.player.physicsEngine = this;
    this.groundLevel = this.levelHeight + 0.5; // Floor top surface position
    this.engine = Engine.create({ gravity: { y: PHYSICS_CONSTANTS.GRAVITY } });

    // Log player spawn position and what's at that position
    console.log(
      "[physicsEngine] Player spawn position:",
      this.player.initialPos
    );
    const spawnX = Math.floor(this.player.initialPos.x);
    const spawnY = Math.floor(this.player.initialPos.y);
    if (
      spawnY >= 0 &&
      spawnY < levelMatrix.length &&
      spawnX >= 0 &&
      spawnX < levelMatrix[0].length
    ) {
      const blockAtSpawn = levelMatrix[spawnY][spawnX];
      console.log("[physicsEngine] Block at player spawn:", blockAtSpawn);
      if (blockAtSpawn && blockAtSpawn.collision === "hazard") {
        console.error(
          "[physicsEngine] WARNING: Player is spawning on a HAZARD block!"
        );
      }
    }

    this.playerBody = Bodies.rectangle(
      this.player.initialPos.x,
      this.player.initialPos.y,
      1,
      1,
      {
        friction: 0,
        frictionAir: 0.01,
        restitution: 0,
        label: "player",
        collisionFilter: {
          category: CollisionCategories.PLAYER,
          mask: CollisionCategories.FLOOR | CollisionCategories.BLOCK,
        },
      }
    );
    World.add(this.engine.world, this.playerBody);
    this.player.reset(); // Call reset after playerBody is created

    // Floor should be positioned so its top aligns with the bottom of the last cell row.
    // levelMatrix.length = N, last cell bottom is at y = N. Center of floor should be N + 0.5 with height 1.
    this.floorBody = Bodies.rectangle(
      this.levelWidth / 2,
      this.levelHeight + 0.5,
      this.levelWidth,
      1,
      {
        isStatic: true,
        label: "floor",
        friction: 0,
        collisionFilter: {
          category: CollisionCategories.FLOOR,
          mask: CollisionCategories.PLAYER,
        },
      }
    );
    World.add(this.engine.world, this.floorBody);
    // Debug: log floor creation and collision filter so we can verify it exists and will interact with the player
    verbose("physicsEngine", "Floor added to world", {
      position: this.floorBody.position,
      bounds: { width: this.levelWidth, height: 1 },
      collisionFilter: (this.floorBody as any).collisionFilter,
    });

    this.blockBodies = [];
    this.initializeLevelBlocks();
    this.keys = {};
    this.isPaused = this.isDead = this.isComplete = this.isDying = false;
    this.lastLaneSwitchTime = 0;
    this.lastJumpPressed = false;
    this.unlockedGroups = new Set();
    this.activeModifiers = new Set();
    this.laneConstraint = null;
    this.groundConstraint = null;
    this._eventListeners = {};

    Events.on(
      this.engine,
      "collisionStart",
      (event: IEventCollision<unknown>) => this.handleCollisions(event)
    );
    this.setupEventListeners();
  }

  initializeLevelBlocks() {
    // remove old block bodies
    this.blockBodies.forEach((body) => {
      try {
        World.remove(this.engine.world, body);
      } catch (e) {
        // ignore
      }
    });
    this.blockBodies = [];
    for (let y = 0; y < this.levelMatrix.length; y++) {
      for (let x = 0; x < this.levelMatrix[y].length; x++) {
        const block = this.levelMatrix[y][x];
        if (
          block &&
          ["solid", "sticky", "hazard"].includes(block.collision || "")
        ) {
          const body = Bodies.rectangle(x + 0.5, y + 0.5, 1, 1, {
            isStatic: true,
            label: block.collision,
            // store block data for collision handling
            // attach coordinates so we can refer back
            blockData: Object.assign({}, block, { x, y }),
            collisionFilter: {
              category: CollisionCategories.BLOCK,
              mask: CollisionCategories.PLAYER,
            },
          } as any);
          World.add(this.engine.world, body);
          this.blockBodies.push(body);
        }
      }
    }
  }

  private getCellAtPosition(x: number, y: number): LevelBlock | null {
    const col = Math.floor(x);
    const row = Math.floor(y);

    if (row < 0 || row >= this.levelMatrix.length) return null;
    const rowData = this.levelMatrix[row];
    if (!rowData || col < 0 || col >= rowData.length) return null;

    return rowData[col] ?? null;
  }

  private isAreaUnsafe(
    x: number,
    y: number,
    halfWidth = 0.49,
    halfHeight = 0.49,
    ignoreCell?: GridCoordinate
  ): boolean {
    const minRow = Math.floor(y - halfHeight);
    const maxRow = Math.floor(y + halfHeight);
    const minCol = Math.floor(x - halfWidth);
    const maxCol = Math.floor(x + halfWidth);

    for (let row = minRow; row <= maxRow; row++) {
      if (row < 0 || row >= this.levelMatrix.length) continue;
      const rowData = this.levelMatrix[row];
      if (!rowData) continue;

      for (let col = minCol; col <= maxCol; col++) {
        if (col < 0 || col >= rowData.length) continue;
        if (ignoreCell && ignoreCell.row === row && ignoreCell.col === col)
          continue;

        const cell = rowData[col];
        if (!cell) continue;

        const collision = cell.collision;
        if (
          collision === "hazard" ||
          collision === "solid" ||
          collision === "sticky"
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private findSafeTeleportDestination(
    startX: number,
    startY: number,
    directionX: number,
    directionY: number,
    distance: number,
    ignoreCell?: GridCoordinate
  ): { x: number; y: number } {
    const maxX = this.levelWidth - 0.5;
    const maxY = this.groundLevel;
    const minX = 0.5;
    const minY = 0.5;

    const stepSize = 0.25;
    const normalizedLength = Math.hypot(directionX, directionY) || 1;
    const dirX = directionX / normalizedLength;
    const dirY = directionY / normalizedLength;
    const steps = Math.max(1, Math.ceil(distance / stepSize));

    let safeX = clamp(startX, minX, maxX);
    let safeY = clamp(startY, minY, maxY);

    for (let i = 1; i <= steps; i++) {
      const t = Math.min(i * stepSize, distance);
      const candidateX = clamp(startX + dirX * t, minX, maxX);
      const candidateY = clamp(startY + dirY * t, minY, maxY);

      if (this.isAreaUnsafe(candidateX, candidateY, 0.49, 0.49, ignoreCell)) {
        break;
      }

      safeX = candidateX;
      safeY = candidateY;
    }

    return { x: safeX, y: safeY };
  }

  private resolveTeleportPath(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    ignoreCell?: GridCoordinate
  ): { x: number; y: number } {
    const clampedTargetX = clamp(targetX, 0.5, this.levelWidth - 0.5);
    const clampedTargetY = clamp(targetY, 0.5, this.groundLevel);
    const directionX = clampedTargetX - startX;
    const directionY = clampedTargetY - startY;
    const distance = Math.hypot(directionX, directionY);

    if (distance === 0) {
      return {
        x: clamp(startX, 0.5, this.levelWidth - 0.5),
        y: clamp(startY, 0.5, this.groundLevel),
      };
    }

    return this.findSafeTeleportDestination(
      startX,
      startY,
      directionX,
      directionY,
      distance,
      ignoreCell
    );
  }

  setupEventListeners() {
    const handler: EventListener = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      // Normalize keys to lower-case for letters, keep "Space" as canonical key
      const keyRaw = keyboardEvent.key;
      const key =
        keyRaw === " " || keyboardEvent.code === "Space"
          ? "Space"
          : keyRaw.toLowerCase();
      // keydown -> true, keyup -> false
      this.keys[key] = keyboardEvent.type === "keydown";
    };
    document.addEventListener("keydown", handler);
    document.addEventListener("keyup", handler);
    this._eventListeners = { keydown: handler, keyup: handler };
  }

  removeEventListeners() {
    Object.entries(this._eventListeners).forEach(([type, handler]) => {
      if (handler) document.removeEventListener(type, handler);
    });
    this._eventListeners = {};
  }

  update(deltaTimeMs: number) {
    if (this.isPaused || !this.playerBody) return;

    // Clamp delta time to prevent physics instability
    const deltaTime = clamp(deltaTimeMs, 0, PHYSICS_CONSTANTS.MAX_DELTA_TIME);
    const currentTime = Date.now();

    // Handle death state
    if (this.isDead) {
      this.handleDeath();
      return;
    }

    // Stop physics updates when level is complete
    if (this.isComplete) {
      return;
    }

    // Process player inputs
    this.processInputs(currentTime);

    // Step the physics engine with clamped delta
    Engine.update(this.engine, deltaTime);

    // Comprehensive physics validation and safety checks
    const pos = this.playerBody.position;
    const vel = this.playerBody.velocity;

    // 1. Check for NaN or Infinity (catastrophic failure)
    if (
      !isSafeNumber(pos.x) ||
      !isSafeNumber(pos.y) ||
      !isSafeNumber(vel.x) ||
      !isSafeNumber(vel.y)
    ) {
      console.error(
        "[PhysicsEngine] CRITICAL: Invalid physics state detected",
        { pos, vel }
      );
      this.emergencyReset();
      return;
    }

    // 2. Check for velocity explosion
    const velocityMagnitude = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    if (velocityMagnitude > PHYSICS_CONSTANTS.MAX_VELOCITY_MAGNITUDE) {
      console.warn(
        "[PhysicsEngine] Velocity explosion detected:",
        velocityMagnitude
      );

      // Normalize velocity to max magnitude
      const scale =
        PHYSICS_CONSTANTS.MAX_VELOCITY_MAGNITUDE / velocityMagnitude;
      Body.setVelocity(this.playerBody, {
        x: vel.x * scale,
        y: vel.y * scale,
      });
    }

    // 3. Position bounds enforcement with smooth clamping
    const minX = 0.5;
    const maxX = this.levelWidth - 0.5;
    const minY = 0.5;
    const maxY = this.groundLevel;

    let needsPositionFix = false;
    let clampedPos = { x: pos.x, y: pos.y };
    let clampedVel = { x: vel.x, y: vel.y };

    if (pos.x < minX - PHYSICS_CONSTANTS.POSITION_EPSILON) {
      clampedPos.x = minX;
      clampedVel.x = Math.max(0, vel.x); // Only allow moving right
      needsPositionFix = true;
    } else if (pos.x > maxX + PHYSICS_CONSTANTS.POSITION_EPSILON) {
      clampedPos.x = maxX;
      clampedVel.x = Math.min(0, vel.x); // Only allow moving left
      needsPositionFix = true;
    }

    if (pos.y < minY - PHYSICS_CONSTANTS.POSITION_EPSILON) {
      clampedPos.y = minY;
      clampedVel.y = Math.max(0, vel.y); // Only allow moving down
      needsPositionFix = true;
    } else if (pos.y > maxY + PHYSICS_CONSTANTS.POSITION_EPSILON) {
      clampedPos.y = maxY;
      clampedVel.y = 0; // Stop vertical movement
      needsPositionFix = true;

      // Reset jump state when hitting ground
      this.player.isOnPlatform = true;
      this.player.isJumping = false;
      this.player.jumpsRemaining = 2;
      this.player.doubleJumpAvailable = true;
      this.player.lastGroundedTime = currentTime;
      this.player.state = PlayerState.GROUNDED;
    }

    if (needsPositionFix) {
      Body.setPosition(this.playerBody, clampedPos);
      Body.setVelocity(this.playerBody, clampedVel);
    }

    // 4. Apply general physics constraints
    this.applyPhysicsConstraints();

    // 5. Update player logic
    this.player.update(deltaTime);

    // 6. Update visual representation
    if (isSafeNumber(pos.x) && isSafeNumber(pos.y)) {
      this.renderEngine?.updatePlayerPosition?.(
        { x: pos.x - 0.5, y: pos.y - 0.5 },
        (this.playerBody.angle * 180) / Math.PI
      );
    }
  }

  // Emergency reset when physics completely breaks
  private emergencyReset() {
    console.error("[PhysicsEngine] Performing emergency reset!");
    if (!this.playerBody) return;

    Body.setPosition(this.playerBody, this.player.initialPos);
    Body.setVelocity(this.playerBody, { x: 0, y: 0 });
    Body.setAngle(this.playerBody, 0);
    Body.setAngularVelocity(this.playerBody, 0);

    this.player.isOnPlatform = true;
    this.player.isJumping = false;
    this.player.jumpsRemaining = 2;
    this.player.doubleJumpAvailable = true;
    this.player.lastGroundedTime = Date.now();
    this.player.state = PlayerState.GROUNDED;
    this.player.rotation = 0;
  }

  processInputs(currentTime: number) {
    if (!this.playerBody || this.isDead || this.isComplete) return;

    // Normalize keys to lowercase
    const down = (k: string) => !!(this.keys[k] || this.keys[k.toLowerCase()]);
    // Jump input with buffering
    const jumpPressed = down("Space") || down("arrowup") || down("w");
    if (jumpPressed && !this.lastJumpPressed) {
      // Buffer jump input
      this.player.inputBuffer.jump = PHYSICS_CONSTANTS.JUMP_BUFFER_TIME;
    }

    // Process buffered jump
    if (this.player.inputBuffer.jump > 0 && this.player.canJump(currentTime)) {
      if (this.player.jump()) {
        this.audioManager?.playJumpSound?.();
        this.player.inputBuffer.jump = 0; // Consume the buffered input
      }
    }

    // Lane switching for clipper mode
    if (
      this.player.mode === "clipper" &&
      currentTime - this.lastLaneSwitchTime >=
        PHYSICS_CONSTANTS.LANE_SWITCH_DELAY
    ) {
      if (down("arrowup") || down("w")) {
        if (this.player.switchLane(-1)) {
          this.lastLaneSwitchTime = currentTime;
        }
      } else if (down("arrowdown") || down("s")) {
        if (this.player.switchLane(1)) {
          this.lastLaneSwitchTime = currentTime;
        }
      }
      this.player.toggleFreeMove(down("Space"));
    }

    // Horizontal movement - always active unless dead/complete
    if (!this.isDead && !this.isComplete && this.playerBody) {
      const targetVelocityX = PHYSICS_CONSTANTS.MOVE_SPEED * this.player.facing;

      // Smoothly interpolate to target velocity to reduce jitter
      const currentVelX = this.playerBody.velocity.x;
      const interpolatedVelX =
        currentVelX + (targetVelocityX - currentVelX) * 0.5;

      Body.setVelocity(this.playerBody, {
        x: interpolatedVelX,
        y: this.playerBody.velocity.y,
      });

      // Bounds check for horizontal position
      const pos = this.playerBody.position;
      if (pos.x < 0.5 || pos.x > this.levelWidth - 0.5) {
        Body.setPosition(this.playerBody, {
          x: clamp(pos.x, 0.5, this.levelWidth - 0.5),
          y: pos.y,
        });
        Body.setVelocity(this.playerBody, {
          x: 0,
          y: this.playerBody.velocity.y,
        });
      }
    }
  }

  applyPhysicsConstraints() {
    const body = this.playerBody;
    if (!body) return;

    const pos = body.position;
    const vel = body.velocity;

    // 1. Validate physics state
    if (
      !isSafeNumber(pos.x) ||
      !isSafeNumber(pos.y) ||
      !isSafeNumber(vel.x) ||
      !isSafeNumber(vel.y)
    ) {
      this.emergencyReset();
      return;
    }

    // 2. Apply velocity limits based on mode
    let maxVelX = PHYSICS_CONSTANTS.MOVE_SPEED;
    let maxVelY = PHYSICS_CONSTANTS.MAX_FALL_SPEED;

    if (this.player.mode === "clipper" && this.player.isFreeMoving) {
      // Free movement in clipper mode
      maxVelX = PHYSICS_CONSTANTS.MOVE_SPEED * 2;
      maxVelY = PHYSICS_CONSTANTS.MOVE_SPEED * 2;
    }

    // Clamp velocities
    const clampedVel = {
      x: clamp(vel.x, -maxVelX, maxVelX),
      y: clamp(vel.y, -maxVelY, maxVelY),
    };

    // Apply epsilon clamping - zero out very small velocities
    if (Math.abs(clampedVel.x) < PHYSICS_CONSTANTS.VELOCITY_EPSILON) {
      clampedVel.x = 0;
    }
    if (Math.abs(clampedVel.y) < PHYSICS_CONSTANTS.VELOCITY_EPSILON) {
      clampedVel.y = 0;
    }

    // Only update if velocity changed
    if (clampedVel.x !== vel.x || clampedVel.y !== vel.y) {
      Body.setVelocity(body, clampedVel);
    }

    // 3. Position constraints
    const minX = 0.5;
    const maxX = this.levelWidth - 0.5;
    const minY = 0.5;
    const maxY = this.groundLevel;

    if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
      Body.setPosition(body, {
        x: clamp(pos.x, minX, maxX),
        y: clamp(pos.y, minY, maxY),
      });

      // Zero velocity in the direction of constraint violation
      const constrainedVel = {
        x: pos.x < minX || pos.x > maxX ? 0 : body.velocity.x,
        y: pos.y < minY || pos.y > maxY ? 0 : body.velocity.y,
      };
      Body.setVelocity(body, constrainedVel);
    }
  }

  async handleDeath() {
    if (this.isDying) return;
    this.isDying = true;
    try {
      await this.renderEngine?.particleSystem?.createExplosion?.(
        {
          x: this.playerBody!.position.x * this.renderEngine!.blockSize,
          y: this.playerBody!.position.y * this.renderEngine!.blockSize,
        },
        this.lastHazardColor || "#FF0000",
        15,
        50
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      this.player.reset();
      this.isDead = false;
      this.isComplete = false;
      if (this.audioManager) {
        this.audioManager.playDeathSound?.();
        if (this.audioManager.restartMusicOnDeath) {
          this.audioManager.backgroundMusicTime = 0;
        } else if (this.audioManager.backgroundMusic) {
          this.audioManager.backgroundMusicTime =
            this.audioManager.backgroundMusic.currentTime || 0;
        }
        if (!this.audioManager.isMuted)
          this.audioManager.pauseBackgroundMusic?.();
      }
      this.resetDisplay();
      if (!window.autoRestart) {
        const gameOverScreen = document.getElementById("gameOverScreen");
        if (gameOverScreen) gameOverScreen.style.display = "block";
      } else {
        setTimeout(() => window.restartGame?.(), 500);
      }
    } finally {
      this.isDying = false;
    }
  }

  handleCollisions(event: IEventCollision<unknown>) {
    if (this.isDead) return;
    this.isDead = this.isComplete = false;

    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      // Debug: report if this pair involves the floor to help diagnose missed collisions
      if (bodyA.label === "floor" || bodyB.label === "floor") {
        verbose("physicsEngine", "Collision pair includes floor", {
          a: { label: bodyA.label, pos: bodyA.position },
          b: { label: bodyB.label, pos: bodyB.position },
        });
      }
      const playerBody =
        bodyA.label === "player"
          ? bodyA
          : bodyB.label === "player"
          ? bodyB
          : null;
      const otherBody = playerBody === bodyA ? bodyB : bodyA;
      const otherBlockData: LevelBlock | undefined = (otherBody as any)
        .blockData;

      if (!playerBody || (!otherBlockData && otherBody.label !== "floor"))
        continue;

      const block = otherBlockData;
      if (block) {
        // handle finish
        if (block.type === BLOCK_TYPE.FINISH) {
          this.isComplete = true;
          if (this.renderEngine) this.renderEngine.isPaused = true;
          this.audioManager?.playCompletionSound?.();
          return;
        }
        // hazard
        if (block.collision === "hazard" && isObjectActive(block)) {
          console.error(
            "[physicsEngine] PLAYER HIT HAZARD! Block:",
            block,
            "at position:",
            block.x,
            block.y
          );
          console.error(
            "[physicsEngine] Player position:",
            playerBody.position
          );
          console.error(
            "[physicsEngine] Block type:",
            block.type,
            "collision:",
            block.collision
          );
          this.isDead = true;
          this.lastHazardColor = block.appearance?.color?.base || "#FF0000";
          this.handleDeath();
          return;
        }
        // modifiers
        if (block.isModifier && !block._activated) {
          this.activateModifier(block);
          block._activated = true;
          this.activeModifiers.add(block);
        }
        // teleporter (generic)
        if (
          block.type === BLOCK_TYPE.TELEPORTER &&
          this.player.teleportCooldown <= 0
        ) {
          debug("physicsEngine", "Teleport block triggered", {
            position: { x: block.x, y: block.y },
            rotation: block.transform?.rotation,
          });

          const angleRad = ((block.transform?.rotation || 0) * Math.PI) / 180;
          const distance = 100 / 32;
          const directionX = Math.cos(angleRad) * this.player.facing;
          const directionY = Math.sin(angleRad);
          const originCell: GridCoordinate = {
            row: Math.floor(playerBody.position.y),
            col: Math.floor(playerBody.position.x),
          };

          const destination = this.findSafeTeleportDestination(
            playerBody.position.x,
            playerBody.position.y,
            directionX,
            directionY,
            distance,
            originCell
          );

          if (
            isSafeNumber(destination.x) &&
            isSafeNumber(destination.y) &&
            (destination.x !== playerBody.position.x ||
              destination.y !== playerBody.position.y)
          ) {
            Body.setPosition(playerBody, destination);
          }

          this.player.teleportCooldown = PHYSICS_CONSTANTS.TELEPORT_COOLDOWN;
        } else if (
          typeof block.type === "number" &&
          (block.type === BLOCK_TYPE.TELEPORT_START ||
            block.type === BLOCK_TYPE.TELEPORT_END) &&
          this.player.teleportCooldown <= 0
        ) {
          const target =
            block.id != null
              ? getTeleportTarget(block, this.levelMatrix as TeleportMatrix)
              : null;

          if (target && isSafeNumber(target.x) && isSafeNumber(target.y)) {
            const originCell: GridCoordinate = {
              row: Math.floor(playerBody.position.y),
              col: Math.floor(playerBody.position.x),
            };
            const targetCenterX = target.x + 0.5;
            const targetCenterY = target.y + 0.5;
            const safeTarget = this.resolveTeleportPath(
              playerBody.position.x,
              playerBody.position.y,
              targetCenterX,
              Math.min(this.groundLevel, targetCenterY),
              originCell
            );

            verbose("physicsEngine", "Teleporting player", {
              from: { x: playerBody.position.x, y: playerBody.position.y },
              to: safeTarget,
            });

            if (isSafeNumber(safeTarget.x) && isSafeNumber(safeTarget.y)) {
              Body.setPosition(playerBody, safeTarget);
            }

            this.player.teleportCooldown = PHYSICS_CONSTANTS.TELEPORT_COOLDOWN;
          }
        } else if (block.type === BLOCK_TYPE.CLASSIC_MODE) {
          this.player.setMode("classic");
          block.group &&
            triggerGroup(
              block.group,
              this.levelMatrix,
              this.player,
              this.cameraManager
            );
        } else if (block.type === BLOCK_TYPE.LEFT_ORB) {
          this.player.setFacing(-1);
        } else if (block.type === BLOCK_TYPE.RIGHT_ORB) {
          this.player.setFacing(1);
        }
      }

      // landing detection: floor or solid/sticky blocks and player is falling (positive y in Matter)
      if (
        (otherBody.label === "floor" ||
          block?.collision === "solid" ||
          block?.collision === "sticky") &&
        playerBody.velocity.y > 0
      ) {
        this.player.isOnPlatform = true;
        this.player.isJumping = false;
        this.player.jumpsRemaining = 2;
        this.player.doubleJumpAvailable = true;
        this.player.lastGroundedTime = Date.now();
        this.player.rotation = 0;
        Body.setAngle(playerBody, 0);
        if (block?.collision === "sticky") {
          Body.setVelocity(playerBody, {
            x: playerBody.velocity.x * 0.5,
            y: playerBody.velocity.y,
          });
        }
      }
    }

    // deactivate modifiers if we moved away
    if (this.activeModifiers.size > 0) {
      const mainPlayerBody = this.playerBody;
      if (!mainPlayerBody) return;
      const { x, y } = mainPlayerBody.position;
      for (const modifier of Array.from(this.activeModifiers)) {
        if (
          Math.hypot((modifier.x ?? 0) + 0.5 - x, (modifier.y ?? 0) + 0.5 - y) >
          1.5
        ) {
          modifier._activated = false;
          this.activeModifiers.delete(modifier);
        }
      }
    }
  }

  reset() {
    this.isDead = this.isComplete = false;
    this.activeModifiers.clear();
    this.lastJumpPressed = false;
    this.activeModifiers.clear();
    if (
      this.playerBody &&
      isFinite(this.playerBody.position.x) &&
      isFinite(this.playerBody.position.y)
    ) {
      this.renderEngine?.updatePlayerPosition?.(
        {
          x: this.playerBody.position.x - 0.5,
          y: this.playerBody.position.y - 0.5,
        },
        (this.playerBody.angle * 180) / Math.PI
      );
    }
    this.resetDisplay();
    this.initializeLevelBlocks();
  }

  cleanup() {
    this.removeEventListeners();
    this.player.cleanup();
    try {
      World.clear(this.engine.world, false);
      Engine.clear(this.engine);
    } catch (e) {
      // ignore clearing errors in some environments
    }
    Object.assign(this, {
      isDead: false,
      isComplete: false,
      keys: {},
      lastLaneSwitchTime: 0,
      lastJumpPressed: false,
    } as Partial<PhysicsEngine>);
  }

  resetDisplay() {
    this.cameraManager?.resetEffects?.();
    this.activeModifiers.clear();
    this.renderEngine?.particleSystem?.reset?.();
    this.isDying = false;
    this.lastLaneSwitchTime = 0;
  }

  updateMatrix(newMatrix: LevelMatrix) {
    this.levelMatrix = newMatrix;
    this.levelWidth = newMatrix[0].length;
    this.levelHeight = newMatrix.length;
    this.groundLevel = this.levelHeight + 0.5; // Floor top surface position
    this.initializeLevelBlocks();
    // also reposition the floor
    if (this.floorBody) {
      Body.setPosition(this.floorBody, {
        x: this.levelWidth / 2,
        y: this.levelHeight + 0.5,
      });
      // width change is not trivial in matter; recreate floor if needed
    }
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  activateModifier(modifier: LevelBlock) {
    if (!modifier?.isModifier) return;
    switch (modifier.modifierType) {
      case 21:
        this.cameraManager?.zoomTo?.(
          modifier.params?.level || 1.5,
          modifier.params?.duration || 2
        );
        break;
      case 22:
        this.cameraManager?.shake?.(
          modifier.params?.intensity || 15,
          modifier.params?.duration || 2
        );
        break;
      case 23:
        this.cameraManager?.tilt?.(
          modifier.params?.angle || 15,
          modifier.params?.direction || "left",
          modifier.params?.duration || 3
        );
        break;
      case 24:
        this.cameraManager?.pan?.(
          modifier.params?.offsetX || 300,
          modifier.params?.offsetY || 150,
          modifier.params?.duration || 3
        );
        break;
      case 25:
        timeManager.setTimeScale(modifier.params?.scale || 0.3);
        if (modifier.params?.duration) {
          setTimeout(
            () => timeManager.resetTimeScale(),
            modifier.params.duration * 1000 || 3000
          );
        }
        break;
    }
    this.renderEngine?.showModifierActivation?.(modifier);
  }
}

export { Player, PhysicsEngine, PHYSICS_CONSTANTS, BLOCK_TYPE };
