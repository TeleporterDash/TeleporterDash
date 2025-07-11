import { getTeleportTarget } from "./teleporterEngine.js";
import { isObjectActive, triggerGroup, handleUnlockOrb } from "./groupManager.js";
import cameraManager from "./cameraManager.js";
import { debug, verbose } from "./logManager.js";
import { timeManager } from "./timeManager.js";
import Matter from "matter-js";

// Constants for better readability and configuration
const PHYSICS_CONSTANTS = {
  GRAVITY: 0.0005, // Adjusted for Matter.js (per frame, not per second)
  MAX_FALL_SPEED: 10, // Matter.js units (pixels per frame)
  MOVE_SPEED: 2, // Matter.js units (pixels per frame)
  JUMP_FORCE: -8, // Matter.js impulse
  DOUBLE_JUMP_FORCE: -9, // Slightly stronger for double jump
  JUMP_BUFFER_TIME: 200, // ms
  COYOTE_TIME: 200, // ms
  LANE_SWITCH_DELAY: 150, // ms
  ROTATION_SPEED: 180, // Degrees per second
};

// Block type enum for better readability
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

class Player {
  constructor(x, y, levelHeight, physicsEngine) {
    this.initialX = x;
    this.initialY = levelHeight * 0.98 - 1; // Position just above floor
    this.levelHeight = levelHeight;
    this.physicsEngine = physicsEngine;
    this.renderEngine = renderEngine;
    this.reset();
  }

  calculateLanePositions() {
    const effectiveLevelHeight = this.levelHeight - 1;
    const laneSpacing = effectiveLevelHeight / 3;
    return [
      laneSpacing * 0.25, // Top lane
      laneSpacing * 1.5, // Middle lane
      effectiveLevelHeight - 0.75, // Bottom lane
    ];
  }

  reset() {
    // Reset game state
    this.mode = "classic";
    this.lane = 1;
    this.isFreeMoving = false;
    this.teleportCooldown = 0;
    this.score = 0;
    this.lanePositions = this.calculateLanePositions();
    this.jumpForce = PHYSICS_CONSTANTS.JUMP_FORCE;
    this.doubleJumpForce = PHYSICS_CONSTANTS.DOUBLE_JUMP_FORCE;
    this.jumpsRemaining = 2;
    this.isJumping = false;
    this.isOnPlatform = true;
    this.doubleJumpAvailable = true;
    this.lastGroundedTime = Date.now();
    this.facing = 1;
    this.rotation = 0;
    this.rotationSpeed = PHYSICS_CONSTANTS.ROTATION_SPEED;
    this.jumpRotationDirection = 1;
    this.laneSwitchCooldown = 0;
    this.laneSwitchDelay = PHYSICS_CONSTANTS.LANE_SWITCH_DELAY;

    // Reset physics body position
    if (this.physicsEngine && this.physicsEngine.playerBody) {
      Matter.Body.setPosition(this.physicsEngine.playerBody, {
        x: this.initialX + 0.5,
        y: this.initialY + 0.5,
      });
      Matter.Body.setVelocity(this.physicsEngine.playerBody, { x: 0, y: 0 });
      Matter.Body.setAngle(this.physicsEngine.playerBody, 0);
    }

    verbose(
      "PhysicsEngine",
      "Player reset: jumpsRemaining =",
      this.jumpsRemaining,
      "doubleJumpAvailable =",
      this.doubleJumpAvailable,
      "rotation =",
      this.rotation,
    );
  }

  jump() {
    if (this.mode !== "classic") {
      verbose("PhysicsEngine", "Jump blocked: mode =", this.mode);
      return false;
    }

    const body = this.physicsEngine.playerBody;
    if (!body) return false;

    if (this.isOnPlatform || this.jumpsRemaining === 2) {
      Matter.Body.applyForce(body, body.position, { x: 0, y: this.jumpForce });
      this.isJumping = true;
      this.isOnPlatform = false;
      this.doubleJumpAvailable = true;
      verbose("PhysicsEngine", "First jump from ground");
    } else if (this.doubleJumpAvailable) {
      Matter.Body.applyForce(body, body.position, { x: 0, y: this.doubleJumpForce });
      this.doubleJumpAvailable = false;
      verbose("PhysicsEngine", "Second jump (double jump) in air");
    } else {
      verbose("PhysicsEngine", "Jump failed: not on ground and no double jump available");
      return false;
    }

    this.jumpsRemaining = this.isOnPlatform ? 1 : 0;
    verbose(
      "PhysicsEngine",
      `Jump performed: vy=${body.velocity.y}, doubleJumpAvailable=${this.doubleJumpAvailable}, isJumping=${this.isJumping}`,
    );
    return true;
  }

  canJump(coyoteTimeWindow, currentTime) {
    const withinCoyoteTime = currentTime - this.lastGroundedTime <= coyoteTimeWindow;
    return (this.isOnPlatform || withinCoyoteTime) || (this.doubleJumpAvailable && this.physicsEngine.playerBody.velocity.y !== 0);
  }

  switchLane(direction) {
    if (this.mode !== "clipper" || this.laneSwitchCooldown > 0) return false;

    const newLane = Math.max(0, Math.min(2, this.lane + direction));
    if (newLane !== this.lane) {
      this.lane = newLane;
      this.laneSwitchCooldown = this.laneSwitchDelay;
      verbose("PhysicsEngine", `Lane switched to ${this.lane}, cooldown started`);

      if (!this.isFreeMoving) {
        Matter.Body.setPosition(this.physicsEngine.playerBody, {
          x: this.physicsEngine.playerBody.position.x,
          y: this.lanePositions[this.lane] + 0.5,
        });
        Matter.Body.setVelocity(this.physicsEngine.playerBody, { x: this.physicsEngine.playerBody.velocity.x, y: 0 });
      }
      return true;
    }
    return false;
  }

  startFreeMove() {
    if (this.mode !== "clipper" || (this.lane !== 0 && this.lane !== 2)) return false;
    this.isFreeMoving = true;
    Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
    this.physicsEngine.laneConstraint = null;
    return true;
  }

  endFreeMove() {
    if (this.mode !== "clipper") return false;
    this.isFreeMoving = false;
    Matter.Body.setPosition(this.physicsEngine.playerBody, {
      x: this.physicsEngine.playerBody.position.x,
      y: this.lanePositions[this.lane] + 0.5,
    });
    Matter.Body.setVelocity(this.physicsEngine.playerBody, { x: this.physicsEngine.playerBody.velocity.x, y: 0 });
    this.physicsEngine.laneConstraint = Matter.Constraint.create({
      bodyA: this.physicsEngine.playerBody,
      pointB: { x: this.physicsEngine.playerBody.position.x, y: this.lanePositions[this.lane] + 0.5 },
      stiffness: 1,
      length: 0,
    });
    Matter.World.add(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
    return true;
  }

  setMode(mode) {
    if (mode === "classic" || mode === "clipper") {
      this.mode = mode;
      const body = this.physicsEngine.playerBody;
      if (mode === "clipper") {
        this.lane = 1;
        Matter.Body.setPosition(body, { x: body.position.x, y: this.lanePositions[this.lane] + 0.5 });
        Matter.Body.setVelocity(body, { x: body.velocity.x, y: 0 });
        Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
        this.physicsEngine.laneConstraint = Matter.Constraint.create({
          bodyA: body,
          pointB: { x: body.position.x, y: this.lanePositions[this.lane] + 0.5 },
          stiffness: 1,
          length: 0,
        });
        Matter.World.add(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
        Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.groundConstraint);
        this.physicsEngine.groundConstraint = null;
        Matter.Body.setStatic(body, false);
        Matter.World.gravity.y = 0;
      } else {
        Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
        this.physicsEngine.laneConstraint = null;
        Matter.World.gravity.y = PHYSICS_CONSTANTS.GRAVITY;
      }
      this.rotation = 0;
      this.jumpRotationDirection = 1;
      return true;
    }
    return false;
  }

  setFacing(direction) {
    if (direction === 1 || direction === -1) {
      this.facing = direction;
      this.jumpRotationDirection = direction;
      return true;
    }
    return false;
  }

  update(deltaTime) {
    if (this.laneSwitchCooldown > 0) {
      this.laneSwitchCooldown = Math.max(0, this.laneSwitchCooldown - deltaTime);
    }
    if (this.teleportCooldown > 0) {
      this.teleportCooldown--;
    }
    if (this.isJumping && this.mode === "classic") {
      this.rotation += this.jumpRotationDirection * this.rotationSpeed * (deltaTime / 1000);
      this.rotation = this.rotation % 360;
      if (this.rotation < 0) this.rotation += 360;
      Matter.Body.setAngle(this.physicsEngine.playerBody, (this.rotation * Math.PI) / 180);
    } else {
      this.rotation = 0;
      Matter.Body.setAngle(this.physicsEngine.playerBody, 0);
    }
  }

  cleanup() {
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
    debug(
      "PhysicsEngine",
      "Player cleanup: jumpsRemaining =",
      this.jumpsRemaining,
      "rotation =",
      this.rotation,
    );
  }
}

class PhysicsEngine {
  constructor(levelMatrix, player, renderEngine, audioManager, cameraManager) {
    this.levelMatrix = levelMatrix;
    this.renderEngine = renderEngine;
    this.audioManager = audioManager;
    this.cameraManager = cameraManager;
    this.player = player || new Player(0, levelMatrix.length - 1, levelMatrix.length, this);
    this.isDead = false;
    this.isComplete = false;
    this.keys = {
      Space: false,
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false,
      w: false,
      a: false,
      s: false,
      d: false,
    };
    this.coyoteTime = PHYSICS_CONSTANTS.COYOTE_TIME;
    this.jumpBufferTime = PHYSICS_CONSTANTS.JUMP_BUFFER_TIME;
    this.lastJumpPressTime = 0;
    this.lastUpdateTime = 0;
    this.lastLaneSwitchTime = 0;
    this.unlockedGroups = new Set();
    this.isPaused = false;
    this.activeModifiers = new Set();
    this.groundLevel = levelMatrix.length + 0.00001;

    // Initialize Matter.js engine
    this.engine = Matter.Engine.create();
    this.engine.gravity.y = PHYSICS_CONSTANTS.GRAVITY;

    // Create player body
    this.playerBody = Matter.Bodies.rectangle(
      this.player.initialX + 0.5,
      this.player.initialY + 0.5,
      1,
      1,
      {
        friction: 0,
        frictionAir: 0,
        restitution: 0,
        label: "player",
      }
    );
    Matter.World.add(this.engine.world, this.playerBody);

    // Create ground
    this.groundConstraint = null;

    // Initialize level blocks
    this.blockBodies = [];
    this.initializeLevelBlocks();

    // Setup collision events
    Matter.Events.on(this.engine, "collisionStart", (event) => this.handleCollisions(event));

    // Setup input event listeners
    this.setupEventListeners();
  }

  initializeLevelBlocks() {
    this.blockBodies.forEach((body) => Matter.World.remove(this.engine.world, body));
    this.blockBodies = [];

    for (let y = 0; y < this.levelMatrix.length; y++) {
      for (let x = 0; x < this.levelMatrix[y].length; x++) {
        const block = this.levelMatrix[y][x];
        if (!block) continue;

        let body;
        if (block.collision === "solid" || block.collision === "sticky" || block.collision === "hazard") {
          body = Matter.Bodies.rectangle(x + 0.5, y + 0.5, 1, 1, {
            isStatic: true,
            label: block.collision,
            blockData: block,
          });
          Matter.World.add(this.engine.world, body);
          this.blockBodies.push(body);
        }
      }
    }
  }

  setupEventListeners() {
    const keydownHandler = (event) => {
      const key = event.key === " " || event.code === "Space" ? "Space" : event.key;
      this.keys[key] = event.type === "keydown";
      if (this.keys[key] && (key === "Space" || key === "ArrowUp" || key === "w")) {
        verbose("PhysicsEngine", `Key pressed: ${key}`);
      }
    };
    const keyupHandler = (event) => {
      const key = event.key === " " || event.code === "Space" ? "Space" : event.key;
      this.keys[key] = event.type === "keyup" ? false : this.keys[key];
    };
    this._eventListeners = { keydown: keydownHandler, keyup: keyupHandler };
    document.addEventListener("keydown", keydownHandler);
    document.addEventListener("keyup", keyupHandler);
  }

  removeEventListeners() {
    if (this._eventListeners.keydown) {
      document.removeEventListener("keydown", this._eventListeners.keydown);
      this._eventListeners.keydown = null;
    }
    if (this._eventListeners.keyup) {
      document.removeEventListener("keyup", this._eventListeners.keyup);
      this._eventListeners.keyup = null;
    }
  }

  update() {
    if (this.isPaused || !this.player) return;

    const currentTime = Date.now();
    const deltaTime = currentTime - this.lastUpdateTime || 16.67; // Assume ~60 FPS if first frame
    this.lastUpdateTime = currentTime;

    // Process jump input
    this.processJumpInput(currentTime);

    if (this.isDead) {
      this.handleDeath();
      return;
    }

    // Process movement input
    this.handleInput();

    // Update physics
    Matter.Engine.update(this.engine, deltaTime);
    this.applyPhysicsConstraints();

    // Update player state
    this.player.update(deltaTime);

    // Update render engine
    this.renderEngine.updatePlayerPosition(
      { x: this.playerBody.position.x - 0.5, y: this.playerBody.position.y - 0.5 },
      (this.playerBody.angle * 180) / Math.PI
    );

    // Process lane switching
    this.processLaneSwitching(currentTime);
  }

  processJumpInput(currentTime) {
    const jumpKeyPressed = this.keys["Space"] || this.keys["ArrowUp"] || this.keys["w"];
    const canJump = this.player.canJump(this.coyoteTime, currentTime);
    const bufferTimeOK = currentTime - this.lastJumpPressTime >= this.jumpBufferTime || this.lastJumpPressTime === 0;

    if (jumpKeyPressed && canJump && bufferTimeOK) {
      this.lastJumpPressTime = currentTime;
      if (this.player.jump() && this.audioManager) {
        this.audioManager.playJumpSound();
        verbose("PhysicsEngine", `Jump executed: vy=${this.playerBody.velocity.y}`);
      }
    }
  }

  processLaneSwitching(currentTime) {
    if (this.player.mode === "clipper") {
      if (
        (this.keys["ArrowUp"] || this.keys["w"]) &&
        currentTime - this.lastLaneSwitchTime >= this.player.laneSwitchDelay
      ) {
        if (this.player.switchLane(-1)) {
          this.lastLaneSwitchTime = currentTime;
        }
      }
      if (
        (this.keys["ArrowDown"] || this.keys["s"]) &&
        currentTime - this.lastLaneSwitchTime >= this.player.laneSwitchDelay
      ) {
        if (this.player.switchLane(1)) {
          this.lastLaneSwitchTime = currentTime;
        }
      }
    }
  }

  handleInput() {
    if (!this.player || this.isDead || this.isComplete) return;

    if (this.player.mode === "classic") {
      Matter.Body.setVelocity(this.playerBody, {
        x: PHYSICS_CONSTANTS.MOVE_SPEED * this.player.facing,
        y: this.playerBody.velocity.y,
      });
    } else if (this.player.mode === "clipper") {
      Matter.Body.setVelocity(this.playerBody, {
        x: PHYSICS_CONSTANTS.MOVE_SPEED * this.player.facing,
        y: this.playerBody.velocity.y,
      });
      if (this.keys["Space"]) {
        this.player.startFreeMove();
      } else {
        this.player.endFreeMove();
      }
    }
  }

  applyPhysicsConstraints() {
    if (this.player.mode === "clipper" && this.player.isFreeMoving) {
      if (this.player.lane === 0) {
        Matter.Body.setVelocity(this.playerBody, {
          x: this.playerBody.velocity.x,
          y: Math.max(-PHYSICS_CONSTANTS.MOVE_SPEED * 2, this.playerBody.velocity.y),
        });
        Matter.Body.setPosition(this.playerBody, {
          x: this.playerBody.position.x,
          y: Math.max(0, this.playerBody.position.y),
        });
      } else if (this.player.lane === 2) {
        Matter.Body.setVelocity(this.playerBody, {
          x: this.playerBody.velocity.x,
          y: Math.min(PHYSICS_CONSTANTS.MOVE_SPEED * 2, this.playerBody.velocity.y),
        });
        Matter.Body.setPosition(this.playerBody, {
          x: this.playerBody.position.x,
          y: Math.min(this.groundLevel, this.playerBody.position.y),
        });
      }
    }

    // Cap fall speed in classic mode
    if (this.player.mode === "classic") {
      Matter.Body.setVelocity(this.playerBody, {
        x: this.playerBody.velocity.x,
        y: Math.min(this.playerBody.velocity.y, PHYSICS_CONSTANTS.MAX_FALL_SPEED),
      });
    }

    // Ensure player stays above ground
    if (this.playerBody.position.y > this.groundLevel) {
      Matter.Body.setPosition(this.playerBody, {
        x: this.playerBody.position.x,
        y: this.groundLevel,
      });
      Matter.Body.setVelocity(this.playerBody, { x: this.playerBody.velocity.x, y: 0 });
      this.player.isOnPlatform = true;
      this.player.isJumping = false;
      this.player.jumpsRemaining = 2;
      this.player.doubleJumpAvailable = true;
      this.player.lastGroundedTime = Date.now();
      this.player.rotation = 0;
      this.lastJumpPressTime = 0;
      verbose("PhysicsEngine", "Player on ground: resetting state");
    }
  }

  async handleDeath() {
    if (this.isDying) return;
    this.isDying = true;

    try {
      const playerX = this.playerBody.position.x * this.renderEngine.blockSize;
      const playerY = this.playerBody.position.y * this.renderEngine.blockSize;
      const explosionColor = this.lastHazardColor || "#FF0000";

      await new Promise((resolve) => {
        if (this.renderEngine && this.renderEngine.particleSystem) {
          this.renderEngine.particleSystem.createExplosion(
            { x: playerX, y: playerY },
            explosionColor,
            15,
            50,
          );
          setTimeout(resolve, 300);
        } else {
          resolve();
        }
      });

      this.player.reset();
    } catch (e) {
      console.error("Error in death sequence:", e);
    } finally {
      this.isDying = false;
    }

    this.isComplete = false;
    if (this.audioManager) {
      this.audioManager.playDeathSound();
      if (this.audioManager.restartMusicOnDeath) {
        this.audioManager.backgroundMusicTime = 0;
      } else if (this.audioManager.backgroundMusic) {
        this.audioManager.backgroundMusicTime = this.audioManager.backgroundMusic.currentTime;
      }
      if (!this.audioManager.isMuted) {
        this.audioManager.pauseBackgroundMusic();
      }
    }

    this.resetDisplay();

    if (!window.autoRestart) {
      const gameOverScreen = document.getElementById("gameOverScreen");
      if (gameOverScreen) gameOverScreen.style.display = "block";
    } else {
      setTimeout(() => {
        if (this.isDead) window.restartGame();
      }, 500);
    }
  }

  handleCollisions(event) {
    if (this.isDead) return;

    this.isDead = false;
    this.isComplete = false;

    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      const playerBody = bodyA.label === "player" ? bodyA : bodyB.label === "player" ? bodyB : null;
      const otherBody = playerBody === bodyA ? bodyB : bodyA;

      if (!playerBody || !otherBody.blockData) continue;

      const block = otherBody.blockData;

      if (block.type === BLOCK_TYPE.FINISH) {
        this.isComplete = true;
        if (this.renderEngine) this.renderEngine.isPaused = true;
        if (this.audioManager) this.audioManager.playCompletionSound();
        debug("PhysicsEngine", "Level complete!");
        return;
      }

      if (block.isModifier && !block._activated) {
        this.activateModifier(block);
        block._activated = true;
        this.activeModifiers.add(block);
      }

      if (block.collision === "hazard" && isObjectActive(block)) {
        this.isDead = true;
        this.lastHazardColor = block.appearance?.color?.base || "#FF0000";
        this.handleDeath().then(() => {
          this.isDead = false;
        });
        return;
      }

      if (block.type === BLOCK_TYPE.TELEPORTER && this.player.teleportCooldown <= 0) {
        const angle = ((block.transform?.rotation || 0) * Math.PI) / 180;
        const distance = 100 / 32;
        let newX = this.playerBody.position.x;
        let newY = this.playerBody.position.y;
        if (angle === 0) {
          newY -= distance;
        } else {
          newX += Math.cos(angle) * distance * this.player.facing;
          newY += Math.sin(angle) * distance;
        }
        newY = Math.min(this.groundLevel, newY);
        Matter.Body.setPosition(this.playerBody, { x: newX, y: newY });
        this.player.teleportCooldown = 15;
      } else if ([BLOCK_TYPE.TELEPORT_START, BLOCK_TYPE.TELEPORT_END].includes(block.type) && this.player.teleportCooldown <= 0) {
        const target = getTeleportTarget(block, this.levelMatrix);
        if (target) {
          Matter.Body.setPosition(this.playerBody, {
            x: target.x + 0.5,
            y: Math.min(this.groundLevel, target.y + 0.5),
          });
          this.player.teleportCooldown = 15;
        }
      } else if (block.type === BLOCK_TYPE.TRIGGER && isObjectActive(block) && this.player.teleportCooldown <= 0) {
        if (block.group) {
          triggerGroup(block.group, this.levelMatrix, this.player, this.cameraManager);
          console.log(`Triggered group ${block.group}`);
        }
      } else if (block.type === BLOCK_TYPE.UNLOCK_ORB && !this.unlockedGroups.has(block.group)) {
        handleUnlockOrb(block, Math.floor(this.playerBody.position.x), Math.floor(this.playerBody.position.y), this.levelMatrix, this.player, this.cameraManager);
        this.unlockedGroups.add(block.group);
        console.log(`Unlocked group ${block.group}`);
      } else if (block.type === BLOCK_TYPE.CLIPPER_MODE) {
        this.player.setMode("clipper");
        debug("PhysicsEngine", "Switched to clipper mode");
      } else if (block.type === BLOCK_TYPE.CLASSIC_MODE) {
        this.player.setMode("classic");
        if (block.group) {
          triggerGroup(block.group, this.levelMatrix, this.player, this.cameraManager);
        }
        debug("PhysicsEngine", "Switched to classic mode");
      } else if (block.type === BLOCK_TYPE.LEFT_ORB) {
        this.player.setFacing(-1);
        debug("PhysicsEngine", "Player facing left");
      } else if (block.type === BLOCK_TYPE.RIGHT_ORB) {
        this.player.setFacing(1);
        debug("PhysicsEngine", "Player facing right");
      }

      if ((block.collision === "solid" || block.collision === "sticky") && isObjectActive(block) && this.playerBody.velocity.y > 0) {
        this.player.isOnPlatform = true;
        this.player.isJumping = false;
        this.player.jumpsRemaining = 2;
        this.player.doubleJumpAvailable = true;
        this.player.lastGroundedTime = Date.now();
        this.player.rotation = 0;
        this.lastJumpPressTime = 0;
        if (block.collision === "sticky") {
          Matter.Body.setVelocity(this.playerBody, {
            x: this.playerBody.velocity.x * 0.5,
            y: this.playerBody.velocity.y,
          });
        }
        verbose("PhysicsEngine", "Landed on platform: resetting state");
      }
    }

    if (this.activeModifiers.size > 0) {
      const playerCenter = this.playerBody.position;
      for (const modifier of this.activeModifiers) {
        const distance = Math.sqrt(
          Math.pow((modifier.x || 0) + 0.5 - playerCenter.x, 2) +
          Math.pow((modifier.y || 0) + 0.5 - playerCenter.y, 2)
        );
        if (distance > 1.5) {
          modifier._activated = false;
          this.activeModifiers.delete(modifier);
        }
      }
    }
  }

  reset() {
    this.player.reset();
    this.isDead = false;
    this.isComplete = false;
    this.activeModifiers.clear();
    this.lastJumpPressTime = 0;
    this.renderEngine.updatePlayerPosition(
      { x: this.playerBody.position.x - 0.5, y: this.playerBody.position.y - 0.5 },
      (this.playerBody.angle * 180) / Math.PI
    );
    this.resetDisplay();
    this.initializeLevelBlocks();
    debug("PhysicsEngine", "PhysicsEngine reset complete.");
  }

  cleanup() {
    this.stopGameLoop();
    this.removeEventListeners();
    this.player.cleanup();
    Matter.World.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
    this.isDead = false;
    this.isComplete = false;
    this.keys = {};
    this.lastJumpPressTime = 0;
  }

  resetDisplay() {
    if (this.cameraManager) {
      this.cameraManager.resetEffects();
    }
    this.activeModifiers.clear();
    if (this.renderEngine && this.renderEngine.particleSystem) {
      this.renderEngine.particleSystem.reset();
    }
    this.isDying = false;
    this.lastLaneSwitchTime = 0;
  }

  stopGameLoop() {
    debug("PhysicsEngine", "Stopping game loop (no-op)");
  }

  updateMatrix(newMatrix) {
    this.levelMatrix = newMatrix;
    this.initializeLevelBlocks();
    debug("PhysicsEngine", "Matrix updated.");
  }

  pause() {
    this.isPaused = true;
    debug("PhysicsEngine", "Physics engine paused.");
  }

  resume() {
    this.isPaused = false;
    this.lastUpdateTime = Date.now();
    debug("PhysicsEngine", "Physics engine resumed.");
  }

  activateModifier(modifier) {
    if (!modifier?.isModifier) return;

    verbose("PhysicsEngine", `Activated modifier type ${modifier.modifierType}`, modifier.params);

    switch (modifier.modifierType) {
      case 21:
        this.cameraManager.zoomTo(modifier.params.level || 1.5, modifier.params.duration || 2);
        break;
      case 22:
        this.cameraManager.shake(modifier.params.intensity || 15, modifier.params.duration || 2);
        break;
      case 23:
        this.cameraManager.tilt(
          modifier.params.angle || 15,
          modifier.params.direction || "left",
          modifier.params.duration || 3
        );
        break;
      case 24:
        this.cameraManager.pan(
          modifier.params.offsetX || 300,
          modifier.params.offsetY || 150,
          modifier.params.duration || 3
        );
        break;
      case 25:
        timeManager.setTimeScale(modifier.params.scale || 0.3);
        if (modifier.params.duration) {
          setTimeout(
            () => timeManager.resetTimeScale(),
            modifier.params.duration * 1000 || 3000
          );
        }
        break;
      default:
        console.warn(`Unknown modifier type: ${modifier.modifierType}`);
    }

    if (this.renderEngine?.showModifierActivation) {
      this.renderEngine.showModifierActivation(modifier);
    }
  }
}

export { Player, PhysicsEngine, PHYSICS_CONSTANTS, BLOCK_TYPE };