import { getTeleportTarget } from "./teleporterEngine"
import { isObjectActive, triggerGroup, handleUnlockOrb } from "./groupManager"
import { timeManager } from "./timeManager"
import Matter from "matter-js";
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

class Player {
  constructor(x, y, levelWidth, levelHeight, physicsEngine) {
    // Ensure the initial position is within bounds
    this.initialPos = { 
      x: Math.max(0.5, Math.min(x + 0.5, levelWidth - 0.5)),
      y: Math.min(levelHeight - 0.5, y + 0.5)
    };
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.physicsEngine = physicsEngine;
    this.lanePositions = [levelHeight / 12, levelHeight / 2, levelHeight - 0.75];
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
    if (this.physicsEngine.playerBody) {
      Matter.Body.setPosition(this.physicsEngine.playerBody, this.initialPos);
      Matter.Body.setVelocity(this.physicsEngine.playerBody, { x: 0, y: 0 });
      Matter.Body.setAngle(this.physicsEngine.playerBody, 0);
    }
  }

  jump() {
    if (this.mode !== "classic") return false;
    const body = this.physicsEngine.playerBody;
    if (!body) return false;

    if (this.isOnPlatform || this.jumpsRemaining === 2) {
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

  canJump(currentTime) {
    return (
      (this.isOnPlatform || currentTime - this.lastGroundedTime <= PHYSICS_CONSTANTS.COYOTE_TIME) ||
      (this.doubleJumpAvailable && this.physicsEngine.playerBody?.velocity.y !== 0)
    );
  }

  switchLane(direction) {
    if (this.mode !== "clipper" || this.laneSwitchCooldown > 0) return false;
    const newLane = Math.max(0, Math.min(2, this.lane + direction));
    if (newLane === this.lane) return false;
    
    this.lane = newLane;
    this.laneSwitchCooldown = PHYSICS_CONSTANTS.LANE_SWITCH_DELAY;
    if (!this.isFreeMoving) {
      const body = this.physicsEngine.playerBody;
      if (body) {
        Matter.Body.setPosition(body, { x: body.position.x, y: this.lanePositions[this.lane] });
        Matter.Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      }
    }
    return true;
  }

  toggleFreeMove(start) {
    if (this.mode !== "clipper" || (this.lane !== 0 && this.lane !== 2)) return false;
    this.isFreeMoving = start;
    const body = this.physicsEngine.playerBody;
    if (!body) return false;
    if (start) {
      Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
      this.physicsEngine.laneConstraint = null;
    } else {
      Matter.Body.setPosition(body, { x: body.position.x, y: this.lanePositions[this.lane] });
      Matter.Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      this.physicsEngine.laneConstraint = Matter.Constraint.create({
        bodyA: body,
        pointB: { x: body.position.x, y: this.lanePositions[this.lane] },
        stiffness: 1,
        length: 0,
      });
      Matter.World.add(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
    }
    return true;
  }

  setMode(mode) {
    if (mode !== "classic" && mode !== "clipper") return false;
    this.mode = mode;
    const body = this.physicsEngine.playerBody;
    if (!body) return false;
    if (mode === "clipper") {
      this.lane = 1;
      Matter.Body.setPosition(body, { x: body.position.x, y: this.lanePositions[1] });
      Matter.Body.setVelocity(body, { x: body.velocity.x, y: 0 });
      this.physicsEngine.laneConstraint = Matter.Constraint.create({
        bodyA: body,
        pointB: { x: body.position.x, y: this.lanePositions[1] },
        stiffness: 1,
        length: 0,
      });
      Matter.World.add(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
      Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.groundConstraint);
      this.physicsEngine.groundConstraint = null;
      Matter.Body.setStatic(body, false);
      this.physicsEngine.engine.gravity.y = 0;
    } else {
      Matter.World.remove(this.physicsEngine.engine.world, this.physicsEngine.laneConstraint);
      this.physicsEngine.laneConstraint = null;
      this.physicsEngine.engine.gravity.y = PHYSICS_CONSTANTS.GRAVITY;
    }
    this.rotation = 0;
    this.jumpRotationDirection = 1;
    return true;
  }

  setFacing(direction) {
    if (direction !== 1 && direction !== -1) return false;
    this.facing = this.jumpRotationDirection = direction;
    return true;
  }

  update(deltaTime) {
    this.laneSwitchCooldown = Math.max(0, this.laneSwitchCooldown - deltaTime);
    this.teleportCooldown = Math.max(0, this.teleportCooldown - deltaTime);
    if (this.isJumping && this.mode === "classic") {
      this.rotation = (this.rotation + this.jumpRotationDirection * PHYSICS_CONSTANTS.ROTATION_SPEED * (deltaTime / 1000)) % 360;
      if (this.physicsEngine.playerBody) {
        Matter.Body.setAngle(this.physicsEngine.playerBody, (this.rotation * Math.PI) / 180);
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
    });
  }
}

class PhysicsEngine {
  constructor(levelMatrix, player, renderEngine, audioManager, cameraManager) {
    this.levelMatrix = levelMatrix;
    this.renderEngine = renderEngine;
    this.audioManager = audioManager;
    this.cameraManager = cameraManager;
    this.levelWidth = levelMatrix[0].length;
    this.levelHeight = levelMatrix.length;
    this.player = player || new Player(0, this.levelHeight - 1, this.levelWidth, this.levelHeight, this);
    this.groundLevel = this.levelHeight - 0.5;
    this.engine = Matter.Engine.create({ gravity: { y: PHYSICS_CONSTANTS.GRAVITY } });
    this.playerBody = Matter.Bodies.rectangle(
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
    Matter.World.add(this.engine.world, this.playerBody);
    this.player.reset(); // Call reset after playerBody is created

    this.floorBody = Matter.Bodies.rectangle(
      levelMatrix[0].length / 2,
      levelMatrix.length + 0.5,
      levelMatrix[0].length,
      1,
      {
        isStatic: true,
        label: "floor",
        friction: 0,
        collisionFilter: { category: CollisionCategories.FLOOR, mask: CollisionCategories.PLAYER },
      }
    );
    Matter.World.add(this.engine.world, this.floorBody);

    this.blockBodies = [];
    this.initializeLevelBlocks();
    this.keys = {};
    this.isPaused = this.isDead = this.isComplete = this.isDying = false;
    this.lastJumpPressTime = this.lastLaneSwitchTime = this.lastUpdateTime = 0;
    this.unlockedGroups = new Set();
    this.activeModifiers = new Set();

    Matter.Events.on(this.engine, "collisionStart", (event) => this.handleCollisions(event));
    this.setupEventListeners();
  }

  initializeLevelBlocks() {
    this.blockBodies.forEach((body) => Matter.World.remove(this.engine.world, body));
    this.blockBodies = [];
    for (let y = 0; y < this.levelMatrix.length; y++) {
      for (let x = 0; x < this.levelMatrix[y].length; x++) {
        const block = this.levelMatrix[y][x];
        if (block && ["solid", "sticky", "hazard"].includes(block.collision)) {
          const body = Matter.Bodies.rectangle(x + 0.5, y + 0.5, 1, 1, {
            isStatic: true,
            label: block.collision,
            blockData: block,
            collisionFilter: { category: CollisionCategories.BLOCK, mask: CollisionCategories.PLAYER },
          });
          Matter.World.add(this.engine.world, body);
          this.blockBodies.push(body);
        }
      }
    }
  }

  setupEventListeners() {
    const handler = (event) => {
      const key = event.key === " " || event.code === "Space" ? "Space" : event.key;
      this.keys[key] = event.type === "keydown";
    };
    document.addEventListener("keydown", handler);
    document.addEventListener("keyup", handler);
    this._eventListeners = { keydown: handler, keyup: handler };
  }

  removeEventListeners() {
    Object.entries(this._eventListeners).forEach(([type, handler]) => document.removeEventListener(type, handler));
    this._eventListeners = {};
  }

  update() {
    if (this.isPaused || !this.playerBody) return;
    const currentTime = Date.now();
    // Clamp deltaTime to prevent large time steps
    const deltaTime = Math.min(currentTime - this.lastUpdateTime || 16.67, 16.67);
    this.lastUpdateTime = currentTime;

    if (this.isDead) {
      this.handleDeath();
      return;
    }

    this.processInputs(currentTime);
    Matter.Engine.update(this.engine, deltaTime);

    // Basic validation of player position and velocity
    const pos = this.playerBody.position;
    const vel = this.playerBody.velocity;
    
    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(vel.x) || !isFinite(vel.y)) {
      debug("physicsEngine", "Invalid player position or velocity detected (NaN or Infinity):", { pos, vel });
      Matter.Body.setPosition(this.playerBody, this.player.initialPos);
      Matter.Body.setVelocity(this.playerBody, { x: 0, y: 0 });
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

      Matter.Body.setPosition(this.playerBody, clampedPos);
      Matter.Body.setVelocity(this.playerBody, newVel);

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
      this.renderEngine.updatePlayerPosition(
        { x: pos.x - 0.5, y: pos.y - 0.5 },
        (this.playerBody.angle * 180) / Math.PI
      );
    } else {
      console.warn("PhysicsEngine: Skipping render update due to invalid position");
    }
  }

  processInputs(currentTime) {
    if (!this.playerBody || this.isDead || this.isComplete) return;

    if (this.keys["Space"] || this.keys["ArrowUp"] || this.keys["w"]) {
      if (
        this.player.canJump(currentTime) &&
        (currentTime - this.lastJumpPressTime >= PHYSICS_CONSTANTS.JUMP_BUFFER_TIME || !this.lastJumpPressTime)
      ) {
        this.lastJumpPressTime = currentTime;
        if (this.player.jump() && this.audioManager) this.audioManager.playJumpSound();
      }
    }
    if (this.player.mode === "clipper" && currentTime - this.lastLaneSwitchTime >= PHYSICS_CONSTANTS.LANE_SWITCH_DELAY) {
      if (this.keys["ArrowUp"] || this.keys["w"]) {
        if (this.player.switchLane(-1)) this.lastLaneSwitchTime = currentTime;
      } else if (this.keys["ArrowDown"] || this.keys["s"]) {
        if (this.player.switchLane(1)) this.lastLaneSwitchTime = currentTime;
      }
      this.player.toggleFreeMove(this.keys["Space"]);
    }
    if (!this.isDead && !this.isComplete && this.playerBody) {
      // Set horizontal velocity
      const targetVelocityX = PHYSICS_CONSTANTS.MOVE_SPEED * this.player.facing;
      Matter.Body.setVelocity(this.playerBody, {
        x: targetVelocityX,
        y: this.playerBody.velocity.y,
      });
      
      // Ensure position is within bounds
      const pos = this.playerBody.position;
      if (pos.x < 0.5 || pos.x > this.levelWidth - 0.5) {
        Matter.Body.setPosition(this.playerBody, {
          x: Math.max(0.5, Math.min(pos.x, this.levelWidth - 0.5)),
          y: pos.y
        });
        Matter.Body.setVelocity(this.playerBody, { x: 0, y: this.playerBody.velocity.y });
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
      Matter.Body.setPosition(body, this.player.initialPos);
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
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
      Matter.Body.setPosition(body, clampedPos);
      Matter.Body.setVelocity(body, clampedVel);

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
      Matter.Body.setVelocity(body, clampedVel);
    }

    if (this.player.mode === "clipper" && this.player.isFreeMoving) {
      const velocityY = this.player.lane === 0
        ? Math.max(-PHYSICS_CONSTANTS.MOVE_SPEED * 2, body.velocity.y)
        : Math.min(PHYSICS_CONSTANTS.MOVE_SPEED * 2, body.velocity.y);
      Matter.Body.setVelocity(body, { 
        x: Math.min(PHYSICS_CONSTANTS.MOVE_SPEED, body.velocity.x),
        y: velocityY 
      });
    }

    if (this.player.mode === "classic") {
      Matter.Body.setVelocity(body, {
        x: Math.min(PHYSICS_CONSTANTS.MOVE_SPEED, body.velocity.x),
        y: Math.min(body.velocity.y, PHYSICS_CONSTANTS.MAX_FALL_SPEED),
      });
    }
  }

  async handleDeath() {
    if (this.isDying) return;
    this.isDying = true;
    try {
      await this.renderEngine?.particleSystem?.createExplosion(
        {
          x: this.playerBody.position.x * this.renderEngine.blockSize,
          y: this.playerBody.position.y * this.renderEngine.blockSize,
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
        this.audioManager.playDeathSound();
        if (this.audioManager.restartMusicOnDeath) {
          this.audioManager.backgroundMusicTime = 0;
        } else if (this.audioManager.backgroundMusic) {
          this.audioManager.backgroundMusicTime = this.audioManager.backgroundMusic.currentTime;
        }
        if (!this.audioManager.isMuted) this.audioManager.pauseBackgroundMusic();
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

  handleCollisions(event) {
    if (this.isDead) return;
    this.isDead = this.isComplete = false;

    for (const { bodyA, bodyB } of event.pairs) {
      const playerBody = bodyA.label === "player" ? bodyA : bodyB.label === "player" ? bodyB : null;
      const otherBody = playerBody === bodyA ? bodyB : bodyA;
      if (!playerBody || (!otherBody.blockData && otherBody.label !== "floor")) continue;

      const block = otherBody.blockData;
      if (block) {
        if (block.type === BLOCK_TYPE.FINISH) {
          this.isComplete = true;
          this.renderEngine.isPaused = true;
          this.audioManager?.playCompletionSound();
          return;
        }
        if (block.collision === "hazard" && isObjectActive(block)) {
          this.isDead = true;
          this.lastHazardColor = block.appearance?.color?.base || "#FF0000";
          this.handleDeath();
          return;
        }
        if (block.isModifier && !block._activated) {
          this.activateModifier(block);
          block._activated = true;
          this.activeModifiers.add(block);
        }
        if (block.type === BLOCK_TYPE.TELEPORTER && this.player.teleportCooldown <= 0) {
          const angle = ((block.transform?.rotation || 0) * Math.PI) / 180;
          const distance = 100 / 32;
          let newX = playerBody.position.x + (angle === 0 ? 0 : Math.cos(angle) * distance * this.player.facing);
          let newY = playerBody.position.y + (angle === 0 ? -distance : Math.sin(angle) * distance);
          newY = Math.min(this.groundLevel, Math.max(0, newY));
          newX = Math.max(0, Math.min(this.levelMatrix[0].length, newX));
          if (isFinite(newX) && isFinite(newY)) {
            Matter.Body.setPosition(playerBody, { x: newX, y: newY });
            this.player.teleportCooldown = 15;
          }
        } else if ([BLOCK_TYPE.TELEPORT_START, BLOCK_TYPE.TELEPORT_END].includes(block.type) && this.player.teleportCooldown <= 0) {
          const target = getTeleportTarget(block, this.levelMatrix);
          if (target && isFinite(target.x) && isFinite(target.y)) {
            Matter.Body.setPosition(playerBody, { x: target.x + 0.5, y: Math.min(this.groundLevel, target.y + 0.5) });
            this.player.teleportCooldown = 15;
          }
        } else if (block.type === BLOCK_TYPE.TRIGGER && isObjectActive(block) && this.player.teleportCooldown <= 0) {
          block.group && triggerGroup(block.group, this.levelMatrix, this.player, this.cameraManager);
        } else if (block.type === BLOCK_TYPE.UNLOCK_ORB && !this.unlockedGroups.has(block.group)) {
          handleUnlockOrb(block, Math.floor(playerBody.position.x), Math.floor(playerBody.position.y), this.levelMatrix, this.player, this.cameraManager);
          this.unlockedGroups.add(block.group);
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

      if ((otherBody.label === "floor" || (block?.collision === "solid" || block?.collision === "sticky")) && playerBody.velocity.y > 0) {
        this.player.isOnPlatform = true;
        this.player.isJumping = false;
        this.player.jumpsRemaining = 2;
        this.player.doubleJumpAvailable = true;
        this.player.lastGroundedTime = Date.now();
        this.player.rotation = 0;
        Matter.Body.setAngle(playerBody, 0);
        if (block?.collision === "sticky") {
          Matter.Body.setVelocity(playerBody, { x: playerBody.velocity.x * 0.5, y: playerBody.velocity.y });
        }
      }
    }

    if (this.activeModifiers.size > 0) {
      const { x, y } = this.playerBody.position;
      for (const modifier of this.activeModifiers) {
        if (Math.hypot(modifier.x + 0.5 - x, modifier.y + 0.5 - y) > 1.5) {
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
      this.renderEngine.updatePlayerPosition(
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
    Matter.World.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
    Object.assign(this, {
      isDead: false,
      isComplete: false,
      keys: {},
      lastJumpPressTime: 0,
      lastLaneSwitchTime: 0,
      isDying: false,
    });
  }

  resetDisplay() {
    this.cameraManager?.resetEffects();
    this.activeModifiers.clear();
    this.renderEngine?.particleSystem?.reset();
    this.isDying = false;
    this.lastLaneSwitchTime = 0;
  }

  updateMatrix(newMatrix) {
    this.levelMatrix = newMatrix;
    this.initializeLevelBlocks();
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
    this.lastUpdateTime = Date.now();
  }

  activateModifier(modifier) {
    if (!modifier?.isModifier) return;
    switch (modifier.modifierType) {
      case 21:
        this.cameraManager.zoomTo(modifier.params?.level || 1.5, modifier.params?.duration || 2);
        break;
      case 22:
        this.cameraManager.shake(modifier.params?.intensity || 15, modifier.params?.duration || 2);
        break;
      case 23:
        this.cameraManager.tilt(modifier.params?.angle || 15, modifier.params?.direction || "left", modifier.params?.duration || 3);
        break;
      case 24:
        this.cameraManager.pan(modifier.params?.offsetX || 300, modifier.params?.offsetY || 150, modifier.params?.duration || 3);
        break;
      case 25:
        timeManager.setTimeScale(modifier.params?.scale || 0.3);
        if (modifier.params?.duration) {
          setTimeout(() => timeManager.resetTimeScale(), modifier.params.duration * 1000 || 3000);
        }
        break;
    }
    this.renderEngine?.showModifierActivation?.(modifier);
  }
}

export { Player, PhysicsEngine, PHYSICS_CONSTANTS, BLOCK_TYPE };