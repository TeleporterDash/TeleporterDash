import { getTeleportTarget } from "./teleporterEngine"
import { isObjectActive, triggerGroup, handleUnlockOrb } from "./groupManager"
import { timeManager } from "./timeManager"
import Matter, {
  Engine,
  World,
  Body,
  Bodies,
  Constraint,
  Events,
  IEventCollision,
} from "matter-js";
import { debug, verbose } from "./logManager"

const PHYSICS_CONSTANTS = {
  GRAVITY: 0.0005,
  MAX_FALL_SPEED: 10,
  MOVE_SPEED: 2,
  JUMP_FORCE: -8,
  DOUBLE_JUMP_FORCE: -9,
  JUMP_BUFFER_TIME: 200,
  COYOTE_TIME: 200,
  LANE_SWITCH_DELAY: 150,
  ROTATION_SPEED: 180,
};

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
};

const CollisionCategories = {
  PLAYER: 0x0001,
  FLOOR: 0x0002,
  BLOCK: 0x0004,
};

type LevelBlock = {
  collision?: string;
  type?: number;
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

type LevelMatrix = LevelBlock[][];

type RenderEngineLike = {
  blockSize: number;
  particleSystem?: {
    createExplosion?: (pos: { x: number; y: number }, color: string, count: number, life: number) => Promise<void>;
    reset?: () => void;
  };
  isPaused?: boolean;
  updatePlayerPosition?: (pos: { x: number; y: number }, angleDeg: number) => void;
  showModifierActivation?: (modifier: any) => void;
};

type AudioManagerLike = {
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

  constructor(x: number, y: number, levelWidth: number, levelHeight: number, physicsEngine?: PhysicsEngine | null) {
    // Ensure the initial position is within bounds
    this.initialPos = {
      x: Math.max(0.5, Math.min(x + 0.5, levelWidth - 0.5)),
      y: Math.min(levelHeight - 0.5, y + 0.5)
    };
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.physicsEngine = physicsEngine || null;
    this.lanePositions = [levelHeight / 4, levelHeight / 2, levelHeight - 0.75];
    // sensible defaults
    this.mode = "classic";
    this.lane = 1;
    this.isFreeMoving = false;
    this.teleportCooldown = 0;
    this.score = 0;
    this.jumpsRemaining = 2;
    this.isJumping = false;
    this.isOnPlatform = false;
    this.doubleJumpAvailable = true;
    this.lastGroundedTime = Date.now();
    this.facing = 1;
    this.rotation = 0;
    this.jumpRotationDirection = 1;
    this.laneSwitchCooldown = 0;
  }

  reset() {
    this.mode = "classic";
    this.lane = 1;
    this.isFreeMoving = false;
    this.teleportCooldown = 0;
    this.score = 0;
    this.jumpsRemaining = 2;
    this.isJumping = false;
    this.isOnPlatform = false;
    this.doubleJumpAvailable = true;
    this.lastGroundedTime = Date.now();
    this.facing = 1;
    this.rotation = 0;
    this.jumpRotationDirection = 1;
    this.laneSwitchCooldown = 0;
    if (this.physicsEngine?.playerBody) {
      Body.setPosition(this.physicsEngine.playerBody, this.initialPos);
      Body.setVelocity(this.physicsEngine.playerBody, { x: 0, y: 0 });
      Body.setAngle(this.physicsEngine.playerBody, 0);
    }
  }

  jump() {
    if (this.mode !== "classic") return false;
    const body = this.physicsEngine?.playerBody;
    if (!body) return false;

    if (this.isOnPlatform || this.jumpsRemaining === 2) {
      // applyForce expects a small force relative to mass; original values probably tuned for the game, keep them
      Matter.Body.applyForce(body, body.position, { x: 0, y: PHYSICS_CONSTANTS.JUMP_FORCE });
      this.isJumping = true;
      this.isOnPlatform = false;
      this.doubleJumpAvailable = true;
    } else if (this.doubleJumpAvailable) {
      Matter.Body.applyForce(body, body.position, { x: 0, y: PHYSICS_CONSTANTS.DOUBLE_JUMP_FORCE });
      this.doubleJumpAvailable = false;
    } else {
      return false;
    }
    this.jumpsRemaining = this.isOnPlatform ? 1 : 0;
    return true;
  }

  canJump(currentTime: number) {
    return (
      (this.isOnPlatform || currentTime - this.lastGroundedTime <= PHYSICS_CONSTANTS.COYOTE_TIME) ||
      (this.doubleJumpAvailable && this.physicsEngine?.playerBody?.velocity.y !== 0)
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
        Body.setPosition(body, { x: body.position.x, y: this.lanePositions[this.lane] });
        Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      }
    }
    return true;
  }

  toggleFreeMove(start: boolean) {
    if (this.mode !== "clipper" || (this.lane !== 0 && this.lane !== 2)) return false;
    this.isFreeMoving = start;
    const body = this.physicsEngine?.playerBody;
    if (!body) return false;
    if (start) {
      if (this.physicsEngine?.laneConstraint) {
        World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
        this.physicsEngine.laneConstraint = null;
      }
    } else {
      Body.setPosition(body, { x: body.position.x, y: this.lanePositions[this.lane] });
      Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      this.physicsEngine!.laneConstraint = Constraint.create({
        bodyA: body,
        pointB: { x: body.position.x, y: this.lanePositions[this.lane] },
        stiffness: 1,
        length: 0,
      });
      World.add(this.physicsEngine!.engine.world, this.physicsEngine!.laneConstraint!);
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
      World.add(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
      if (this.physicsEngine.groundConstraint) {
        World.remove(this.physicsEngine.engine.world, this.physicsEngine.groundConstraint);
        this.physicsEngine.groundConstraint = null;
      }
      Body.setStatic(body, false);
      this.physicsEngine.engine.gravity.y = 0;
    } else {
      if (this.physicsEngine.laneConstraint) {
        World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
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
    this.laneSwitchCooldown = Math.max(0, this.laneSwitchCooldown - deltaTime);
    this.teleportCooldown = Math.max(0, this.teleportCooldown - deltaTime);
    if (this.isJumping && this.mode === "classic") {
      this.rotation = (this.rotation + this.jumpRotationDirection * PHYSICS_CONSTANTS.ROTATION_SPEED * (deltaTime / 1000)) % 360;
      if (this.physicsEngine?.playerBody) {
        Body.setAngle(this.physicsEngine.playerBody, (this.rotation * Math.PI) / 180);
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
  lastJumpPressTime: number;
  lastLaneSwitchTime: number;
  lastUpdateTime: number;
  unlockedGroups: Set<string | number>;
  activeModifiers: Set<LevelBlock>;
  laneConstraint: Constraint | null;
  groundConstraint: Constraint | null;
  lastHazardColor?: string;
  _eventListeners: Record<string, EventListener | undefined>;

  constructor(levelMatrix: LevelMatrix, player?: Player, renderEngine?: RenderEngineLike, audioManager?: AudioManagerLike, cameraManager?: CameraManagerLike) {
    this.levelMatrix = levelMatrix;
    this.renderEngine = renderEngine;
    this.audioManager = audioManager;
    this.cameraManager = cameraManager;
    this.levelWidth = levelMatrix[0].length;
    this.levelHeight = levelMatrix.length;
    this.player = player || new Player(0, this.levelHeight - 1, this.levelWidth, this.levelHeight, this);
    this.player.physicsEngine = this;
    this.groundLevel = this.levelHeight - 0.5;
    this.engine = Engine.create({ gravity: { y: PHYSICS_CONSTANTS.GRAVITY } });

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
        collisionFilter: { category: CollisionCategories.PLAYER, mask: CollisionCategories.FLOOR | CollisionCategories.BLOCK },
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
        collisionFilter: { category: CollisionCategories.FLOOR, mask: CollisionCategories.PLAYER },
      }
    );
    World.add(this.engine.world, this.floorBody);

    this.blockBodies = [];
    this.initializeLevelBlocks();
    this.keys = {};
    this.isPaused = this.isDead = this.isComplete = this.isDying = false;
    this.lastJumpPressTime = this.lastLaneSwitchTime = 0;
    this.lastUpdateTime = Date.now();
    this.unlockedGroups = new Set();
    this.activeModifiers = new Set();
    this.laneConstraint = null;
    this.groundConstraint = null;
    this._eventListeners = {};

    Events.on(this.engine, "collisionStart", (event: IEventCollision<Matter.ICollisionPair>) => this.handleCollisions(event));
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
        if (block && ["solid", "sticky", "hazard"].includes(block.collision || "")) {
          const body = Bodies.rectangle(x + 0.5, y + 0.5, 1, 1, {
            isStatic: true,
            label: block.collision,
            // store block data for collision handling
            // attach coordinates so we can refer back
            blockData: Object.assign({}, block, { x, y }),
            collisionFilter: { category: CollisionCategories.BLOCK, mask: CollisionCategories.PLAYER },
          } as any);
          World.add(this.engine.world, body);
          this.blockBodies.push(body);
        }
      }
    }
  }

  setupEventListeners() {
    const handler = (event: KeyboardEvent) => {
      // Normalize keys to lower-case for letters, keep "Space" as canonical key
      const keyRaw = event.key;
      const key = (keyRaw === " " || event.code === "Space") ? "Space" : keyRaw.toLowerCase();
      // keydown -> true, keyup -> false
      this.keys[key] = event.type === "keydown";
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

  update() {
    if (this.isPaused || !this.playerBody) return;
    const currentTime = Date.now();
    // Compute deltaTime (ms) with a safe clamp to avoid large steps
    let deltaTime = currentTime - (this.lastUpdateTime || currentTime);
    deltaTime = Math.min(deltaTime || 16.67, 16.67);
    this.lastUpdateTime = currentTime;

    if (this.isDead) {
      this.handleDeath();
      return;
    }

    this.processInputs(currentTime);
    // Use the fixed small step for stability
    Engine.update(this.engine, deltaTime);

    // Basic validation of player position and velocity
    const pos = this.playerBody.position;
    const vel = this.playerBody.velocity;

    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(vel.x) || !isFinite(vel.y)) {
      debug("physicsEngine", "Invalid player position or velocity detected (NaN or Infinity):", { pos, vel });
      Body.setPosition(this.playerBody, this.player.initialPos);
      Body.setVelocity(this.playerBody, { x: 0, y: 0 });
      this.player.isOnPlatform = true;
      this.player.isJumping = false;
      this.player.jumpsRemaining = 2;
      this.player.doubleJumpAvailable = true;
      this.player.lastGroundedTime = currentTime;
      return;
    }

    // Position bounds check
    const minX = 0.5;
    const maxX = this.levelWidth - 0.5;
    const minY = 0.5;
    const maxY = this.groundLevel;

    if (pos.x < minX || pos.x > maxX || pos.y < minY || pos.y > maxY) {
      debug("physicsEngine", `Player out of bounds at {x: ${pos.x}, y: ${pos.y}}, bounds are ${minX}-${maxX} x ${minY}-${maxY}`);

      // Clamp position
      const clampedPos = {
        x: Math.max(minX, Math.min(pos.x, maxX)),
        y: Math.max(minY, Math.min(pos.y, maxY))
      };

      // Stop movement if hitting boundaries
      const newVel = {
        x: (pos.x < minX || pos.x > maxX) ? 0 : vel.x,
        y: (pos.y < minY || pos.y > maxY) ? 0 : vel.y
      };

      Body.setPosition(this.playerBody, clampedPos);
      Body.setVelocity(this.playerBody, newVel);

      // Reset player state when hitting ground
      if (pos.y >= maxY) {
        this.player.isOnPlatform = true;
        this.player.isJumping = false;
        this.player.jumpsRemaining = 2;
        this.player.doubleJumpAvailable = true;
        this.player.lastGroundedTime = currentTime;
      }
    }

    this.applyPhysicsConstraints();
    this.player.update(deltaTime);
    if (isFinite(pos.x) && isFinite(pos.y)) {
      this.renderEngine?.updatePlayerPosition?.(
        { x: pos.x - 0.5, y: pos.y - 0.5 },
        (this.playerBody.angle * 180) / Math.PI
      );
    } else {
      console.warn("PhysicsEngine: Skipping render update due to invalid position");
    }
  }

  processInputs(currentTime: number) {
    if (!this.playerBody || this.isDead || this.isComplete) return;

    // Accept lowercase keys; normalized in setupEventListeners
    const down = (k: string) => !!(this.keys[k] || this.keys[k.toLowerCase()]);
    if (down("Space") || down("arrowup") || down("w")) {
      if (
        this.player.canJump(currentTime) &&
        (currentTime - this.lastJumpPressTime >= PHYSICS_CONSTANTS.JUMP_BUFFER_TIME || !this.lastJumpPressTime)
      ) {
        this.lastJumpPressTime = currentTime;
        if (this.player.jump() && this.audioManager) this.audioManager.playJumpSound();
      }
    }
    if (this.player.mode === "clipper" && currentTime - this.lastLaneSwitchTime >= PHYSICS_CONSTANTS.LANE_SWITCH_DELAY) {
      if (down("arrowup") || down("w")) {
        if (this.player.switchLane(-1)) this.lastLaneSwitchTime = currentTime;
      } else if (down("arrowdown") || down("s")) {
        if (this.player.switchLane(1)) this.lastLaneSwitchTime = currentTime;
      }
      this.player.toggleFreeMove(!!this.keys["Space"]);
    }
    if (!this.isDead && !this.isComplete && this.playerBody) {
      // Set horizontal velocity (preserve vertical velocity)
      const targetVelocityX = PHYSICS_CONSTANTS.MOVE_SPEED * this.player.facing;
      Body.setVelocity(this.playerBody, {
        x: targetVelocityX,
        y: this.playerBody.velocity.y,
      });

      // Ensure position is within bounds (extra safety)
      const pos = this.playerBody.position;
      if (pos.x < 0.5 || pos.x > this.levelWidth - 0.5) {
        Body.setPosition(this.playerBody, {
          x: Math.max(0.5, Math.min(pos.x, this.levelWidth - 0.5)),
          y: pos.y
        });
        Body.setVelocity(this.playerBody, { x: 0, y: this.playerBody.velocity.y });
      }
    }
  }

  applyPhysicsConstraints() {
    const body = this.playerBody;
    if (!body) return;

    // Get current position and velocity
    const pos = body.position;
    const vel = body.velocity;

    // Handle invalid positions first
    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(vel.x) || !isFinite(vel.y)) {
      debug("physicsEngine", "Invalid position or velocity detected, resetting player");
      Body.setPosition(body, this.player.initialPos);
      Body.setVelocity(body, { x: 0, y: 0 });
      return;
    }

    // Determine if player is out of bounds
    const isOutOfBoundsX = pos.x < 0.5 || pos.x > this.levelWidth - 0.5;
    const isOutOfBoundsY = pos.y < 0.5 || pos.y > this.groundLevel;

    if (isOutOfBoundsX || isOutOfBoundsY) {
      // Clamp position
      const clampedPos = {
        x: Math.max(0.5, Math.min(pos.x, this.levelWidth - 0.5)),
        y: Math.max(0.5, Math.min(pos.y, this.groundLevel))
      };

      // Clamp velocity - stop movement in the direction of the boundary
      const clampedVel = {
        x: isOutOfBoundsX ? 0 : vel.x,
        y: isOutOfBoundsY ? 0 : vel.y
      };

      // Apply position and velocity constraints
      Body.setPosition(body, clampedPos);
      Body.setVelocity(body, clampedVel);

      // Reset player state if hitting ground
      if (pos.y >= this.groundLevel) {
        this.player.isOnPlatform = true;
        this.player.isJumping = false;
        this.player.jumpsRemaining = 2;
        this.player.doubleJumpAvailable = true;
        this.player.lastGroundedTime = Date.now();
      }
      return;
    }

    // Apply general velocity constraints
    const maxVelocity = PHYSICS_CONSTANTS.MOVE_SPEED * 2;
    const clampedVel = {
      x: Math.max(-maxVelocity, Math.min(vel.x, maxVelocity)),
      y: Math.max(-maxVelocity, Math.min(vel.y, PHYSICS_CONSTANTS.MAX_FALL_SPEED))
    };

    if (clampedVel.x !== vel.x || clampedVel.y !== vel.y) {
      Body.setVelocity(body, clampedVel);
    }

    if (this.player.mode === "clipper" && this.player.isFreeMoving) {
      const velocityY = this.player.lane === 0
        ? Math.max(-PHYSICS_CONSTANTS.MOVE_SPEED * 2, body.velocity.y)
        : Math.min(PHYSICS_CONSTANTS.MOVE_SPEED * 2, body.velocity.y);
      Body.setVelocity(body, {
        x: Math.min(PHYSICS_CONSTANTS.MOVE_SPEED, body.velocity.x),
        y: velocityY
      });
    }

    if (this.player.mode === "classic") {
      Body.setVelocity(body, {
        x: Math.min(PHYSICS_CONSTANTS.MOVE_SPEED, body.velocity.x),
        y: Math.min(body.velocity.y, PHYSICS_CONSTANTS.MAX_FALL_SPEED),
      });
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
          this.audioManager.backgroundMusicTime = this.audioManager.backgroundMusic.currentTime || 0;
        }
        if (!this.audioManager.isMuted) this.audioManager.pauseBackgroundMusic?.();
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

  handleCollisions(event: IEventCollision<Matter.ICollisionPair>) {
    if (this.isDead) return;
    this.isDead = this.isComplete = false;

    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      const playerBody = bodyA.label === "player" ? bodyA : bodyB.label === "player" ? bodyB : null;
      const otherBody = playerBody === bodyA ? bodyB : bodyA;
      const otherBlockData: LevelBlock | undefined = (otherBody as any).blockData;

      if (!playerBody || (!otherBlockData && otherBody.label !== "floor")) continue;

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
        if (block.type === BLOCK_TYPE.TELEPORTER && this.player.teleportCooldown <= 0) {
          const angleRad = ((block.transform?.rotation || 0) * Math.PI) / 180;
          const distance = 100 / 32;
          let newX = playerBody.position.x + Math.cos(angleRad) * distance * this.player.facing;
          let newY = playerBody.position.y + Math.sin(angleRad) * distance;
          // clamp into playable area (0.5..levelWidth-0.5 / groundLevel)
          newY = Math.min(this.groundLevel, Math.max(0.5, newY));
          newX = Math.max(0.5, Math.min(this.levelWidth - 0.5, newX));
          if (isFinite(newX) && isFinite(newY)) {
            Body.setPosition(playerBody, { x: newX, y: newY });
            this.player.teleportCooldown = 15;
          }
        } else if ([BLOCK_TYPE.TELEPORT_START, BLOCK_TYPE.TELEPORT_END].includes(block.type as number) && this.player.teleportCooldown <= 0) {
          const target = getTeleportTarget(block, this.levelMatrix);
          if (target && isFinite(target.x) && isFinite(target.y)) {
            Body.setPosition(playerBody, { x: target.x + 0.5, y: Math.min(this.groundLevel, target.y + 0.5) });
            this.player.teleportCooldown = 15;
          }
        } else if (block.type === BLOCK_TYPE.TRIGGER && isObjectActive(block) && this.player.teleportCooldown <= 0) {
          block.group && triggerGroup(block.group, this.levelMatrix, this.player, this.cameraManager);
        } else if (block.type === BLOCK_TYPE.UNLOCK_ORB && !this.unlockedGroups.has(block.group as any)) {
          handleUnlockOrb(block, Math.floor(playerBody.position.x), Math.floor(playerBody.position.y), this.levelMatrix, this.player, this.cameraManager);
          this.unlockedGroups.add(block.group as any);
        } else if (block.type === BLOCK_TYPE.CLIPPER_MODE) {
          this.player.setMode("clipper");
        } else if (block.type === BLOCK_TYPE.CLASSIC_MODE) {
          this.player.setMode("classic");
          block.group && triggerGroup(block.group, this.levelMatrix, this.player, this.cameraManager);
        } else if (block.type === BLOCK_TYPE.LEFT_ORB) {
          this.player.setFacing(-1);
        } else if (block.type === BLOCK_TYPE.RIGHT_ORB) {
          this.player.setFacing(1);
        }
      }

      // landing detection: floor or solid/sticky blocks and player is falling (positive y in Matter)
      if ((otherBody.label === "floor" || (block?.collision === "solid" || block?.collision === "sticky")) && playerBody.velocity.y > 0) {
        this.player.isOnPlatform = true;
        this.player.isJumping = false;
        this.player.jumpsRemaining = 2;
        this.player.doubleJumpAvailable = true;
        this.player.lastGroundedTime = Date.now();
        this.player.rotation = 0;
        Body.setAngle(playerBody, 0);
        if (block?.collision === "sticky") {
          Body.setVelocity(playerBody, { x: playerBody.velocity.x * 0.5, y: playerBody.velocity.y });
        }
      }
    }

    // deactivate modifiers if we moved away
    if (this.activeModifiers.size > 0) {
      const { x, y } = this.playerBody.position;
      for (const modifier of Array.from(this.activeModifiers)) {
        if (Math.hypot((modifier.x ?? 0) + 0.5 - x, (modifier.y ?? 0) + 0.5 - y) > 1.5) {
          modifier._activated = false;
          this.activeModifiers.delete(modifier);
        }
      }
    }
  }

  reset() {
    this.player.reset();
    this.isDead = this.isComplete = false;
    this.activeModifiers.clear();
    this.lastJumpPressTime = 0;
    if (this.playerBody && isFinite(this.playerBody.position.x) && isFinite(this.playerBody.position.y)) {
      this.renderEngine?.updatePlayerPosition?.(
        { x: this.playerBody.position.x - 0.5, y: this.playerBody.position.y - 0.5 },
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
      lastJumpPressTime: 0,
      lastLaneSwitchTime: 0,
      isDying: false,
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
    this.groundLevel = this.levelHeight - 0.5;
    this.initializeLevelBlocks();
    // also reposition the floor
    if (this.floorBody) {
      Body.setPosition(this.floorBody, { x: this.levelWidth / 2, y: this.levelHeight + 0.5 });
      // width change is not trivial in matter; recreate floor if needed
    }
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.lastUpdateTime = Date.now();
  }

  activateModifier(modifier: LevelBlock) {
    if (!modifier?.isModifier) return;
    switch (modifier.modifierType) {
      case 21:
        this.cameraManager?.zoomTo?.(modifier.params?.level || 1.5, modifier.params?.duration || 2);
        break;
      case 22:
        this.cameraManager?.shake?.(modifier.params?.intensity || 15, modifier.params?.duration || 2);
        break;
      case 23:
        this.cameraManager?.tilt?.(modifier.params?.angle || 15, modifier.params?.direction || "left", modifier.params?.duration || 3);
        break;
      case 24:
        this.cameraManager?.pan?.(modifier.params?.offsetX || 300, modifier.params?.offsetY || 150, modifier.params?.duration || 3);
        break;
      case 25:
        timeManager.setTimeScale(modifier.params?.scale || 0.3);
        if (modifier.params?.duration) {
          setTimeout(() => timeManager.resetTimeScale(), (modifier.params.duration * 1000) || 3000);
        }
        break;
    }
    this.renderEngine?.showModifierActivation?.(modifier);
  }
}

export { Player, PhysicsEngine, PHYSICS_CONSTANTS, BLOCK_TYPE };
