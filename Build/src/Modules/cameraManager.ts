// Modules/cameraManager.js
import { warn, debug, verbose, setLogLevel } from "./logManager";
import { gsap } from "gsap";
import _ from "lodash";
import type { DebouncedFunc } from "lodash";
import type { Container } from "pixi.js";
import type { Player } from "./physicsEngine";

type ShakePattern = "random" | "horizontal" | "vertical" | "circular";

interface Vector2 {
  x: number;
  y: number;
}

interface VelocitySample extends Vector2 {
  time: number;
}

interface CameraBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CameraZoneConfig {
  smoothing?: number;
  deadZone?: number;
  keepFloorVisible?: boolean;
  lookAhead?: boolean;
  effects?: Record<string, unknown>;
}

interface CameraZoneSettings {
  smoothing: number;
  deadZone: number;
  keepFloorVisible: boolean;
  lookAhead: boolean;
  effects: Record<string, unknown>;
}

interface CameraZone extends CameraZoneSettings {
  bounds: ZoneBounds;
}

interface CameraZoneState extends CameraZone {
  name: string;
}

interface FollowTarget extends Vector2 {}

interface ResettableTarget {
  initialX?: number;
  initialY?: number;
  initialPos?: Vector2;
  x?: number;
  y?: number;
}

interface PerformanceStats {
  frameCount: number;
  totalTime: number;
  avgUpdateTime: number;
  maxUpdateTime: number;
}

type EventCallback = (...args: unknown[]) => void;

type CameraEvents = Map<string, Set<EventCallback>>;

interface CameraState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  zoom: number;
  bounds: CameraBounds;
  currentZone: string | null;
  performance: PerformanceStats;
}

type GsapTween = gsap.core.Tween;

type TweenLike = GsapTween | null;

interface CameraEffects {
  zoom: { tween: TweenLike; level: number; min: number; max: number };
  shake: { tween: TweenLike; intensity: number; originalPos: Vector2 | null };
  tilt: { tween: TweenLike; angle: number };
  pan: { tween: TweenLike; offset: Vector2 };
  drift: { enabled: boolean; speed: number; amplitude: number };
  focus: { target: FollowTarget | null; strength: number; radius: number };
}

/**
 * Enhanced CameraManager
 * Handles camera movement, tracking, and effects for the game
 */
export default class CameraManager {
  private readonly container: Container;
  levelWidth: number;
  levelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  smoothing: number;
  adaptiveSmoothing: boolean;
  maxSmoothingSpeed: number;
  minSmoothingFactor: number;
  maxSmoothingFactor: number;
  deadZoneThreshold: number;
  adaptiveDeadZone: boolean;
  baseDeadZone: number;
  maxDeadZone: number;
  predictiveTracking: boolean;
  predictionStrength: number;
  velocityHistory: VelocitySample[];
  maxVelocityHistory: number;
  lookAhead: boolean;
  lookAheadDistance: number;
  lookAheadSmoothing: number;
  bounds: CameraBounds;
  keepFloorVisible: boolean;
  floorOffset: number;
  zones: Map<string, CameraZone>;
  currentZone: CameraZoneState | null;
  updateThrottle: number;
  lastUpdateTime: number;
  isDirty: boolean;
  effects: CameraEffects;
  events: CameraEvents;
  handleResize: DebouncedFunc<() => void> | null;
  performanceStats: PerformanceStats;

  constructor(
    container: Container,
    levelWidth: number,
    levelHeight: number,
    viewportWidth: number,
    viewportHeight: number
  ) {
    this.container = container;
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;

    // Current camera position
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;

    // Camera smoothing configuration
    this.smoothing = 0.1;
    this.adaptiveSmoothing = true; // Enable adaptive smoothing based on movement speed
    this.maxSmoothingSpeed = 500; // Pixels per second threshold for max smoothing
    this.minSmoothingFactor = 0.02;
    this.maxSmoothingFactor = 0.1;

    // Dead zone configuration
    this.deadZoneThreshold = 0.05;
    this.adaptiveDeadZone = true;
    this.baseDeadZone = 0.05;
    this.maxDeadZone = 0.15;

    // Predictive tracking
    this.predictiveTracking = false;
    this.predictionStrength = 0.3;
    this.velocityHistory = [];
    this.maxVelocityHistory = 5;

    // Look-ahead configuration
    this.lookAhead = false;
    this.lookAheadDistance = 100;
    this.lookAheadSmoothing = 0.1;

    // Bounds and constraints
    this.bounds = {
      left: 0,
      right: levelWidth - viewportWidth,
      top: 0,
      bottom: levelHeight - viewportHeight,
    };

    // Floor visibility
    this.keepFloorVisible = true;
    this.floorOffset = 32;

    // Camera zones for different behaviors
    this.zones = new Map<string, CameraZone>();
    this.currentZone = null;

    // Performance optimization
    this.updateThrottle = 16; // ~60fps
    this.lastUpdateTime = 0;
    this.isDirty = false;

    // Enhanced effects system
    this.effects = {
      zoom: { tween: null, level: 1.0, min: 0.1, max: 5.0 },
      shake: { tween: null, intensity: 0, originalPos: null },
      tilt: { tween: null, angle: 0 },
      pan: { tween: null, offset: { x: 0, y: 0 } },
      drift: { enabled: false, speed: 0.5, amplitude: 10 },
      focus: { target: null, strength: 0.8, radius: 200 },
    };

    // Event system
    this.events = new Map<string, Set<EventCallback>>();
    this.handleResize = null;
    this.performanceStats = {
      frameCount: 0,
      totalTime: 0,
      avgUpdateTime: 0,
      maxUpdateTime: 0,
    };

    // Initialize
    this.init();
  }

  /**
   * Initialize camera system
   */
  init(): void {
    // Set up viewport resize handling
    this.setupViewportHandling();

    // Initialize performance monitoring
    this.setupPerformanceMonitoring();

    debug("CameraManager", "Camera system initialized");
  }

  /**
   * Set up viewport resize handling
   */
  setupViewportHandling(): void {
    // Debounced resize handler
    this.handleResize = _.debounce(() => {
      this.updateDimensions(
        this.levelWidth,
        this.levelHeight,
        this.viewportWidth,
        this.viewportHeight
      );
    }, 100);
  }

  /**
   * Set up performance monitoring
   */
  setupPerformanceMonitoring(): void {
    this.performanceStats = {
      frameCount: 0,
      totalTime: 0,
      avgUpdateTime: 0,
      maxUpdateTime: 0,
    };
  }

  /**
   * Add camera zone with specific behavior
   * @param {string} name - Zone name
   * @param {Object} bounds - Zone bounds {x, y, width, height}
   * @param {Object} config - Zone configuration
   */
  addZone(
    name: string,
    bounds: ZoneBounds,
    config: CameraZoneConfig = {}
  ): void {
    this.zones.set(name, {
      bounds,
      smoothing: config.smoothing ?? this.smoothing,
      deadZone: config.deadZone ?? this.deadZoneThreshold,
      keepFloorVisible:
        config.keepFloorVisible !== undefined
          ? config.keepFloorVisible
          : this.keepFloorVisible,
      lookAhead:
        config.lookAhead !== undefined ? config.lookAhead : this.lookAhead,
      effects: config.effects ?? {},
    });
  }

  /**
   * Check if point is in zone
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} zone - Zone configuration
   */
  isInZone(x: number, y: number, zone: CameraZone): boolean {
    const { bounds } = zone;
    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  /**
   * Update current zone based on target position
   * @param {number} targetX - Target X position
   * @param {number} targetY - Target Y position
   */
  updateCurrentZone(targetX: number, targetY: number): void {
    let newZone: CameraZoneState | null = null;

    for (const [name, zone] of this.zones) {
      if (this.isInZone(targetX, targetY, zone)) {
        newZone = { name, ...zone };
        break;
      }
    }

    if (newZone !== this.currentZone) {
      this.currentZone = newZone;
      this.onZoneChange(newZone);
    }
  }

  /**
   * Handle zone change
   * @param {Object} newZone - New zone configuration
   */
  onZoneChange(newZone: CameraZoneState | null): void {
    if (newZone) {
      debug("CameraManager", `Entered zone: ${newZone.name}`);
      this.smoothing = newZone.smoothing;
      this.deadZoneThreshold = newZone.deadZone;
      this.keepFloorVisible = newZone.keepFloorVisible;
      this.lookAhead = newZone.lookAhead;

      // Apply zone effects
      if (newZone.effects) {
        Object.keys(newZone.effects).forEach((effect) => {
          this.applyEffect(effect, newZone.effects[effect]);
        });
      }
    } else {
      debug("CameraManager", "Exited all zones");
      this.resetToDefaults();
    }
  }

  /**
   * Reset camera to default settings
   */
  resetToDefaults(): void {
    this.smoothing = 0.1;
    this.deadZoneThreshold = 0.05;
    this.keepFloorVisible = true;
    this.lookAhead = true;
  }

  applyEffect(effect: string, config: unknown): void {
    const capitalized = effect.charAt(0).toUpperCase() + effect.slice(1);
    const handlerName = `apply${capitalized}Effect`;
    const handler = (this as Record<string, unknown>)[handlerName];
    if (typeof handler === "function") {
      (handler as (value: unknown) => void)(config);
    } else {
      verbose("cameraManager", `No handler registered for effect '${effect}'`);
    }
  }

  /**
   * Enhanced follow with predictive tracking and look-ahead
   * @param {Object} target - Target to follow
   * @param {number} offsetX - X offset from center
   * @param {number} offsetY - Y offset from center
   */
  follow(target: FollowTarget, offsetX = 0, offsetY = 0): void {
    if (
      !target ||
      typeof target.x !== "number" ||
      typeof target.y !== "number"
    ) {
      warn("cameraManager", "Invalid target for camera follow:", target);
      return;
    }

    // Update velocity history for predictive tracking
    this.updateVelocityHistory(target);

    // Check for zone changes
    this.updateCurrentZone(target.x, target.y);

    // Calculate base position with look-ahead
    let baseX = target.x;
    let baseY = target.y;

    // Apply look-ahead based on movement direction
    if (this.lookAhead && this.velocityHistory.length > 0) {
      const velocity = this.getAverageVelocity();
      const speed = Math.sqrt(
        velocity.x * velocity.x + velocity.y * velocity.y
      );

      if (speed > 50) {
        // Only apply look-ahead if moving fast enough
        const lookAheadFactor = Math.min(speed / 300, 1.0); // Scale based on speed
        baseX += velocity.x * this.lookAheadDistance * lookAheadFactor * 0.016; // Assuming 60fps
        baseY += velocity.y * this.lookAheadDistance * lookAheadFactor * 0.016;
      }
    }

    // Horizontal offset for showing more ahead
    const horizOffset = -this.viewportWidth * 0.2;

    // Calculate target position
    this.targetX = baseX - this.viewportWidth / 2 + horizOffset + offsetX;
    this.targetY = baseY - this.viewportHeight / 2 + offsetY;

    // Apply predictive tracking
    if (this.predictiveTracking && this.velocityHistory.length > 1) {
      const prediction = this.getPredictedPosition(target);
      this.targetX = _.clamp(
        this.targetX + (prediction.x - target.x) * this.predictionStrength,
        this.bounds.left,
        this.bounds.right
      );
      this.targetY = _.clamp(
        this.targetY + (prediction.y - target.y) * this.predictionStrength,
        this.bounds.top,
        this.bounds.bottom
      );
    }

    // Ensure floor visibility
    if (this.keepFloorVisible) {
      const floorY = this.levelHeight - this.floorOffset;
      const minCameraY = floorY - this.viewportHeight;
      this.targetY = Math.max(this.targetY, minCameraY);
    }

    this.isDirty = true;
  }

  /**
   * Update velocity history for predictive tracking
   * @param {Object} target - Target object
   */
  updateVelocityHistory(target: FollowTarget): void {
    if (this.velocityHistory.length === 0) {
      this.velocityHistory.push({ x: target.x, y: target.y, time: Date.now() });
      return;
    }

    const lastPos = this.velocityHistory[this.velocityHistory.length - 1];
    const currentTime = Date.now();
    const deltaTime = (currentTime - lastPos.time) / 1000; // Convert to seconds

    if (deltaTime > 0) {
      const velocity = {
        x: (target.x - lastPos.x) / deltaTime,
        y: (target.y - lastPos.y) / deltaTime,
        time: currentTime,
      };

      this.velocityHistory.push(velocity);

      // Keep history size manageable
      if (this.velocityHistory.length > this.maxVelocityHistory) {
        this.velocityHistory.shift();
      }
    }
  }

  /**
   * Get average velocity from history
   * @returns {Object} Average velocity
   */
  getAverageVelocity(): Vector2 {
    if (this.velocityHistory.length < 2) return { x: 0, y: 0 };

    const recent = this.velocityHistory.slice(-3); // Use last 3 samples
    const avgX = recent.reduce((sum, v) => sum + v.x, 0) / recent.length;
    const avgY = recent.reduce((sum, v) => sum + v.y, 0) / recent.length;

    return { x: avgX, y: avgY };
  }

  /**
   * Get predicted position based on velocity
   * @param {Object} target - Current target
   * @returns {Object} Predicted position
   */
  getPredictedPosition(target: FollowTarget): Vector2 {
    const velocity = this.getAverageVelocity();
    const predictionTime = 0.1; // Predict 100ms ahead

    return {
      x: target.x + velocity.x * predictionTime,
      y: target.y + velocity.y * predictionTime,
    };
  }

  /**
   * Enhanced update with adaptive smoothing and performance optimization
   * @param {number} deltaTime - Time since last update in milliseconds
   */
  update(deltaTime: number = 16): void {
    const startTime = performance.now();

    // Calculate adaptive smoothing based on movement speed
    const targetSpeed = Math.sqrt(
      Math.pow(this.targetX - this.x, 2) + Math.pow(this.targetY - this.y, 2)
    );

    let smoothingFactor = this.smoothing;
    if (this.adaptiveSmoothing) {
      const speedRatio = Math.min(targetSpeed / this.maxSmoothingSpeed, 1.0);
      smoothingFactor = _.clamp(
        this.minSmoothingFactor +
          (this.maxSmoothingFactor - this.minSmoothingFactor) * speedRatio,
        this.minSmoothingFactor,
        this.maxSmoothingFactor
      );
    }

    // Calculate adaptive dead zone
    let deadZoneThreshold = this.deadZoneThreshold;
    if (this.adaptiveDeadZone) {
      const velocity = this.getAverageVelocity();
      const speed = Math.sqrt(
        velocity.x * velocity.x + velocity.y * velocity.y
      );
      const speedRatio = Math.min(speed / 200, 1.0);
      deadZoneThreshold =
        this.baseDeadZone + (this.maxDeadZone - this.baseDeadZone) * speedRatio;
    }

    // Calculate dead zone in pixels
    const deadZoneX = this.viewportWidth * deadZoneThreshold;
    const deadZoneY = this.viewportHeight * deadZoneThreshold;

    // Calculate movement delta
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;

    let nextX = this.x;
    let nextY = this.y;

    // Apply smoothing with dead zone
    if (Math.abs(dx) > deadZoneX) {
      nextX += dx * smoothingFactor;
    }

    if (Math.abs(dy) > deadZoneY) {
      nextY += dy * smoothingFactor;
    }

    // Apply drift effect if enabled
    if (this.effects.drift.enabled) {
      const time = performance.now() / 1000;
      nextX +=
        Math.sin(time * this.effects.drift.speed) *
        this.effects.drift.amplitude;
      nextY +=
        Math.cos(time * this.effects.drift.speed * 0.7) *
        this.effects.drift.amplitude *
        0.5;
    }

    // Limit movement per frame to prevent insane jumps
    const maxMove = 100; // pixels per frame
    nextX = this.x + _.clamp(nextX - this.x, -maxMove, maxMove);
    nextY = this.y + _.clamp(nextY - this.y, -maxMove, maxMove);

    // Clamp position within bounds
    this.x = _.clamp(nextX, this.bounds.left, this.bounds.right);
    this.y = _.clamp(nextY, this.bounds.top, this.bounds.bottom);

    // Apply position to container
    this.container.x = -this.x;
    this.container.y = -this.y;

    // Update performance stats
    const updateTime = performance.now() - startTime;
    this.updatePerformanceStats(updateTime);

    this.isDirty = false;

    verbose(
      "cameraManager",
      `Update: X=${this.x.toFixed(2)}, Y=${this.y.toFixed(
        2
      )}, Smoothing=${smoothingFactor.toFixed(3)}`
    );
  }

  /**
   * Update performance statistics
   * @param {number} updateTime - Time taken for update
   */
  updatePerformanceStats(updateTime: number): void {
    this.performanceStats.frameCount++;
    this.performanceStats.totalTime += updateTime;
    this.performanceStats.avgUpdateTime =
      this.performanceStats.totalTime / this.performanceStats.frameCount;
    this.performanceStats.maxUpdateTime = Math.max(
      this.performanceStats.maxUpdateTime,
      updateTime
    );
  }

  /**
   * Enhanced zoom with easing options
   * @param {number} level - Zoom level
   * @param {number} duration - Animation duration
   * @param {string} ease - Easing function
   * @param {Function} onComplete - Completion callback
   */
  zoomTo(
    level: number,
    duration = 0.5,
    ease = "power2.inOut",
    onComplete: (() => void) | null = null
  ): void {
    if (this.effects.zoom.tween) this.effects.zoom.tween.kill();

    const targetLevel = _.clamp(
      level,
      this.effects.zoom.min,
      this.effects.zoom.max
    );

    if (duration <= 0) {
      this.container.scale.set(targetLevel);
      this.effects.zoom.level = targetLevel;
      if (onComplete) onComplete();
      return;
    }

    this.effects.zoom.tween = gsap.to(this.container.scale, {
      x: targetLevel,
      y: targetLevel,
      duration: duration,
      ease: ease,
      onUpdate: () => {
        this.effects.zoom.level = this.container.scale.x;
        // Maintain center pivot
        this.container.pivot.set(
          this.viewportWidth / 2,
          this.viewportHeight / 2
        );
        this.container.position.set(
          this.viewportWidth / 2,
          this.viewportHeight / 2
        );
      },
      onComplete: () => {
        if (onComplete) onComplete();
      },
    });
  }

  /**
   * Enhanced shake with different patterns
   * @param {number} intensity - Shake intensity
   * @param {number} duration - Shake duration
   * @param {string} pattern - Shake pattern ('random', 'horizontal', 'vertical', 'circular')
   */
  shake(
    intensity: number = 5,
    duration = 0.5,
    pattern: ShakePattern = "random"
  ): void {
    if (this.effects.shake.tween) this.effects.shake.tween.kill();

    const originalX = this.container.x;
    const originalY = this.container.y;
    this.effects.shake.originalPos = { x: originalX, y: originalY };
    this.effects.shake.intensity = intensity;

    const shakePatterns: Record<ShakePattern, (time: number) => Vector2> = {
      random: (_time: number) => ({
        x: (Math.random() - 0.5) * intensity * 2,
        y: (Math.random() - 0.5) * intensity * 2,
      }),
      horizontal: (_time: number) => ({
        x: (Math.random() - 0.5) * intensity * 2,
        y: 0,
      }),
      vertical: (_time: number) => ({
        x: 0,
        y: (Math.random() - 0.5) * intensity * 2,
      }),
      circular: (time: number) => ({
        x: Math.cos(time * 30) * intensity,
        y: Math.sin(time * 30) * intensity,
      }),
    };

    const getOffset = shakePatterns[pattern];
    let startTime = Date.now();

    this.effects.shake.tween = gsap.to(
      {},
      {
        duration: duration,
        ease: "power2.out",
        onUpdate: () => {
          const elapsed = (Date.now() - startTime) / 1000;
          const decay = 1 - elapsed / duration;
          const offset = getOffset(elapsed);

          this.container.x = originalX + offset.x * decay;
          this.container.y = originalY + offset.y * decay;
        },
        onComplete: () => {
          this.container.x = originalX;
          this.container.y = originalY;
          this.effects.shake.intensity = 0;
          this.effects.shake.originalPos = null;
        },
      }
    );
  }

  /**
   * Smooth camera transition to position
   * @param {number} x - Target X position
   * @param {number} y - Target Y position
   * @param {number} duration - Transition duration
   * @param {string} ease - Easing function
   * @param {Function} onComplete - Completion callback
   */
  transitionTo(
    x: number,
    y: number,
    duration = 1.0,
    ease = "power2.inOut",
    onComplete: (() => void) | null = null
  ): GsapTween {
    return gsap.to(this, {
      targetX: x,
      targetY: y,
      duration: duration,
      ease: ease,
      onUpdate: () => {
        this.isDirty = true;
      },
      onComplete: () => {
        if (onComplete) onComplete();
      },
    });
  }

  /**
   * Focus on a specific target with smooth transition
   * @param {Object} target - Target to focus on
   * @param {number} duration - Focus duration
   * @param {number} zoom - Optional zoom level
   */
  focusOn(
    target: FollowTarget | null,
    duration = 1.0,
    zoom: number | null = null
  ): GsapTween | undefined {
    if (!target) return;

    const targetX = target.x - this.viewportWidth / 2;
    const targetY = target.y - this.viewportHeight / 2;

    // Store current focus
    this.effects.focus.target = target;

    // Transition to target
    const transition = this.transitionTo(targetX, targetY, duration);

    // Apply zoom if specified
    if (zoom !== null) {
      this.zoomTo(zoom, duration);
    }

    return transition;
  }

  /**
   * Apply drift effect
   * @param {boolean} enabled - Enable drift
   * @param {number} speed - Drift speed
   * @param {number} amplitude - Drift amplitude
   */
  setDrift(enabled: boolean, speed = 0.5, amplitude = 10): void {
    this.effects.drift.enabled = enabled;
    this.effects.drift.speed = speed;
    this.effects.drift.amplitude = amplitude;
  }

  /**
   * Get current camera state
   * @returns {Object} Camera state
   */
  getState(): CameraState {
    return {
      x: this.x,
      y: this.y,
      targetX: this.targetX,
      targetY: this.targetY,
      zoom: this.effects.zoom.level,
      bounds: { ...this.bounds },
      currentZone: this.currentZone?.name || null,
      performance: { ...this.performanceStats },
    };
  }

  /**
   * Set camera bounds with validation
   * @param {number} left - Left bound
   * @param {number} right - Right bound
   * @param {number} top - Top bound
   * @param {number} bottom - Bottom bound
   */
  setBounds(left: number, right: number, top: number, bottom: number): void {
    // Clamp bounds to prevent camera from going beyond the world limits
    // But ensure the camera can still move within a reasonable range
    const maxRight = Math.max(right - this.viewportWidth, 0);
    const maxBottom = Math.max(bottom - this.viewportHeight, 0);
    
    this.bounds = {
      left: Math.max(0, left),
      right: maxRight,
      top: Math.max(0, top),
      bottom: maxBottom,
    };
    
    debug("CameraManager", `Bounds set to: ${this.bounds.left}-${this.bounds.right} x ${this.bounds.top}-${this.bounds.bottom}`);
  }

  /**
   * Enhanced reset with smooth transition option
   * @param {Object} player - Player object
   * @param {boolean} smooth - Use smooth transition
   * @param {number} duration - Transition duration if smooth
   */
  reset(
    player: ResettableTarget | Player,
    smooth = false,
    duration = 1.0
  ): void {
    debug("CameraManager", "Resetting camera position...");

    // Reset effects
    this.resetEffects();

    // Get player position - player.x/y are already in block coordinates
    // We need to convert to pixel coordinates
    const blockSize = (window as any).blockSize || 32;
    let playerPixelX: number;
    let playerPixelY: number;
    
    if ('initialPos' in player && player.initialPos) {
      // initialPos is in physics coordinates (already has 0.5 offset)
      playerPixelX = player.initialPos.x * blockSize;
      playerPixelY = player.initialPos.y * blockSize;
    } else if ('x' in player && 'y' in player && typeof player.x === 'number' && typeof player.y === 'number') {
      // Current position
      playerPixelX = player.x * blockSize;
      playerPixelY = player.y * blockSize;
    } else {
      // Fallback to 0,0
      playerPixelX = 0;
      playerPixelY = 0;
    }
    
    const resetX = playerPixelX - this.viewportWidth / 2;
    const resetY = playerPixelY - this.viewportHeight / 2;

    if (smooth) {
      this.transitionTo(resetX, resetY, duration);
    } else {
      this.setPosition(resetX, resetY);
    }

    // Clear velocity history
    this.velocityHistory = [];
    this.currentZone = null;
    this.isDirty = false;

    debug(
      "CameraManager",
      `Camera reset to: (${resetX.toFixed(2)}, ${resetY.toFixed(2)})`
    );
  }

  /**
   * Enhanced setPosition with bounds checking
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  setPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.x = _.clamp(x, this.bounds.left, this.bounds.right);
    this.y = _.clamp(y, this.bounds.top, this.bounds.bottom);

    // Apply position to container
    this.container.x = -this.x;
    this.container.y = -this.y;

    this.isDirty = false;
  }

  /**
   * Reset all camera effects
   */
  resetEffects(): void {
    Object.values(this.effects).forEach((effect) => {
      const tween = (effect as { tween?: TweenLike }).tween;
      if (tween) tween.kill();
    });

    // Reset container transforms
    this.container.scale.set(1);
    this.container.rotation = 0;
    this.container.skew.set(0);
    this.container.pivot.set(0);
    this.container.filters = null;

    // Reset effect states
    this.effects.zoom.level = 1.0;
    this.effects.shake.intensity = 0;
    this.effects.shake.originalPos = null;
    this.effects.tilt.angle = 0;
    this.effects.drift.enabled = false;
    this.effects.focus.target = null;
  }

  /**
   * Update camera dimensions with smooth transition
   * @param {number} levelWidth - Level width
   * @param {number} levelHeight - Level height
   * @param {number} viewportWidth - Viewport width
   * @param {number} viewportHeight - Viewport height
   */
  updateDimensions(
    levelWidth: number,
    levelHeight: number,
    viewportWidth: number,
    viewportHeight: number
  ): void {
    this.levelWidth = levelWidth;
    this.levelHeight = levelHeight;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;

    // Update bounds
    this.setBounds(
      0,
      levelWidth - viewportWidth,
      0,
      levelHeight - viewportHeight
    );

    // Revalidate current position
    this.setPosition(this.x, this.y);
  }

  /**
   * Get performance statistics
   * @returns {Object} Performance stats
   */
  getPerformanceStats(): PerformanceStats {
    return { ...this.performanceStats };
  }

  /**
   * Clean up camera manager
   */
  dispose(): void {
    this.resetEffects();
    this.zones.clear();
    this.events.clear();
    this.velocityHistory = [];
    debug("CameraManager", "Camera manager disposed");
  }
}
