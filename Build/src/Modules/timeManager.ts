// Modules/timeManager.ts
import { gsap } from "gsap";
import _ from "lodash";
import { storageManager } from "./storageManager";

type TweenTimeline = ReturnType<typeof gsap.timeline>;

type TimeEffect = {
  apply: (manager: TimeManager) => void;
  remove?: (manager: TimeManager) => void;
};

type ScheduledEvent = {
  callback: () => void;
  triggerTime: number;
  repeat: boolean;
  delay: number | null;
};

type PerformanceMetrics = {
  frameTime: number;
  worstFrame: number;
  bestFrame: number;
  lagSpikes: number;
};

type TimeManagerSettings = {
  targetFPS: number;
  adaptiveSync: boolean;
  vsyncMode: "auto" | "on" | "off";
  performanceMode: "balanced" | "performance" | "quality";
};

type TimeEventListener = (eventName: string, data?: unknown) => void;

class TimeManager {
  private lastTime = 0;
  private deltaTime = 0;
  private timeScale = 1;
  private paused = false;
  private accumulator = 0;
  private fixedTimeStep = 1 / 60;
  private scaledDelta = 0;

  private frameCount = 0;
  private totalTime = 0;
  private averageFPS = 0;
  private fpsHistory: number[] = [];
  private maxFPSHistory = 60;

  private readonly timeEffects = new Map<string, TimeEffect>();
  private readonly tweenTimeline: TweenTimeline;
  private readonly scheduledEvents = new Map<string, ScheduledEvent>();

  private performanceMetrics: PerformanceMetrics = {
    frameTime: 0,
    worstFrame: 0,
    bestFrame: Infinity,
    lagSpikes: 0,
  };

  private settings: TimeManagerSettings = {
    targetFPS: 60,
    adaptiveSync: true,
    vsyncMode: "auto",
    performanceMode: "balanced",
  };

  onTimeEvent?: TimeEventListener;

  constructor() {
    this.tweenTimeline = gsap.timeline({ paused: true });
    void this.init();
  }

  async init(): Promise<void> {
    // Load saved settings
    try {
      const savedSettings =
        await storageManager.getFromStore<TimeManagerSettings>(
          "game",
          "timeManagerSettings"
        );
      if (savedSettings) {
        this.settings = { ...this.settings, ...savedSettings };
        this.fixedTimeStep = 1 / this.settings.targetFPS;
      }
    } catch (error) {
      console.warn("Could not load TimeManager settings:", error);
    }
  }

  // Enhanced update method with performance monitoring
  update(currentTime?: number): number {
    if (currentTime === undefined) currentTime = performance.now();

    // Calculate raw delta time in seconds
    const rawDelta = (currentTime - (this.lastTime || currentTime)) / 1000;
    this.lastTime = currentTime;

    // If paused, return 0 delta time
    if (this.paused) {
      return 0;
    }

    // Apply time scale and cap max delta to prevent spiral of death
    this.deltaTime = Math.min(rawDelta * this.timeScale, 0.25);

    // Update performance metrics
    this.updatePerformanceMetrics(rawDelta);

    // Update fixed timestep accumulator
    this.accumulator += this.deltaTime;
    this.totalTime += this.deltaTime;

    // Update frame count and FPS
    this.frameCount++;
    this.updateFPS(rawDelta);

    // Process scheduled events
    this.processScheduledEvents();

    // Update GSAP timeline for time effects
    this.tweenTimeline.progress(this.totalTime % 1);

    return this.deltaTime;
  }

  // FPS calculation with rolling average
  private updateFPS(deltaTime: number): void {
    if (deltaTime > 0) {
      const currentFPS = 1 / deltaTime;
      this.fpsHistory.push(currentFPS);

      if (this.fpsHistory.length > this.maxFPSHistory) {
        this.fpsHistory.shift();
      }

      this.averageFPS = _.mean(this.fpsHistory);
    }
  }

  // Performance monitoring
  private updatePerformanceMetrics(deltaTime: number): void {
    this.performanceMetrics.frameTime = deltaTime * 1000; // Convert to ms

    if (
      this.performanceMetrics.frameTime > this.performanceMetrics.worstFrame
    ) {
      this.performanceMetrics.worstFrame = this.performanceMetrics.frameTime;
    }

    if (this.performanceMetrics.frameTime < this.performanceMetrics.bestFrame) {
      this.performanceMetrics.bestFrame = this.performanceMetrics.frameTime;
    }

    // Detect lag spikes (frames taking more than 2x target time)
    const targetFrameTime = 1000 / this.settings.targetFPS;
    if (this.performanceMetrics.frameTime > targetFrameTime * 2) {
      this.performanceMetrics.lagSpikes++;
    }
  }

  // Enhanced fixed update with interpolation support
  runFixedUpdate(callback: (fixedDelta: number) => void): boolean {
    if (this.accumulator >= this.fixedTimeStep) {
      callback(this.fixedTimeStep);
      this.accumulator -= this.fixedTimeStep;
      return true;
    }
    return false;
  }

  // Time scaling with smooth transitions using GSAP
  setTimeScale(scale: number, duration = 0): void {
    scale = Math.max(0, scale);

    if (duration > 0) {
      gsap.to(this, {
        timeScale: scale,
        duration: duration,
        ease: "power2.inOut",
      });
    } else {
      this.timeScale = scale;
    }
  }

  // Enhanced pause/unpause with state management
  pause(): void {
    this.paused = true;
    this.tweenTimeline.pause();
    this.emit("paused");
  }

  resume(): void {
    this.paused = false;
    this.tweenTimeline.resume();
    this.emit("resumed");
  }

  // Time effects using GSAP
  addTimeEffect(name: string, effect: TimeEffect): this {
    this.timeEffects.set(name, effect);
    effect.apply(this);
    return this;
  }

  removeTimeEffect(name: string): this {
    const effect = this.timeEffects.get(name);
    if (effect?.remove) {
      effect.remove(this);
    }
    this.timeEffects.delete(name);
    return this;
  }

  // Smooth time scale effects
  slowMotion(factor = 0.5, duration = 0.5): this {
    this.setTimeScale(factor, duration);
    return this;
  }

  speedUp(factor = 2, duration = 0.5): this {
    this.setTimeScale(factor, duration);
    return this;
  }

  resetTimeScale(duration = 0.5): this {
    this.setTimeScale(1.0, duration);
    return this;
  }

  // Time freeze effect
  freeze(duration = 1): this {
    const originalScale = this.timeScale;
    this.setTimeScale(0, 0.1);

    setTimeout(() => {
      this.setTimeScale(originalScale, 0.1);
    }, duration * 1000);

    return this;
  }

  // Event scheduling system
  scheduleEvent(callback: () => void, delay: number, repeat = false): string {
    const eventId = _.uniqueId("timeEvent_");
    const triggerTime = this.totalTime + delay;

    this.scheduledEvents.set(eventId, {
      callback,
      triggerTime,
      repeat,
      delay: repeat ? delay : null,
    });

    return eventId;
  }

  cancelEvent(eventId: string): void {
    this.scheduledEvents.delete(eventId);
  }

  // Process scheduled events
  private processScheduledEvents(): void {
    for (const [eventId, event] of this.scheduledEvents) {
      if (this.totalTime >= event.triggerTime) {
        event.callback();

        if (event.repeat && event.delay) {
          // Reschedule for next occurrence
          event.triggerTime = this.totalTime + event.delay;
        } else {
          // Remove one-time event
          this.scheduledEvents.delete(eventId);
        }
      }
    }
  }

  // Settings management
  async updateSettings(
    newSettings: Partial<TimeManagerSettings>
  ): Promise<void> {
    this.settings = { ...this.settings, ...newSettings };

    // Apply settings
    if (newSettings.targetFPS) {
      this.fixedTimeStep = 1 / newSettings.targetFPS;
    }

    // Save to storage
    try {
      await storageManager.saveToStore(
        "game",
        "timeManagerSettings",
        this.settings
      );
    } catch (error) {
      console.warn("Could not save TimeManager settings:", error);
    }
  }

  // Getters for various time measurements
  get time(): number {
    return this.totalTime;
  }

  get frameTime(): number {
    return this.performanceMetrics.frameTime;
  }

  get fps(): number {
    return this.averageFPS;
  }

  get interpolationAlpha(): number {
    return this.accumulator / this.fixedTimeStep;
  }

  get isRunningSmooth(): boolean {
    return this.averageFPS > this.settings.targetFPS * 0.9;
  }

  // Performance analysis
  getPerformanceReport(): Record<string, number> {
    return {
      averageFPS: Math.round(this.averageFPS),
      frameTime: Math.round(this.performanceMetrics.frameTime * 100) / 100,
      worstFrame: Math.round(this.performanceMetrics.worstFrame * 100) / 100,
      bestFrame: Math.round(this.performanceMetrics.bestFrame * 100) / 100,
      lagSpikes: this.performanceMetrics.lagSpikes,
      totalFrames: this.frameCount,
      uptime: Math.round(this.totalTime * 100) / 100,
    };
  }

  // Reset performance metrics
  resetPerformanceMetrics(): void {
    this.performanceMetrics = {
      frameTime: 0,
      worstFrame: 0,
      bestFrame: Infinity,
      lagSpikes: 0,
    };
    this.fpsHistory = [];
    this.frameCount = 0;
  }

  // Simple event system
  emit(eventName: string, data?: unknown): void {
    // Could be enhanced with a proper event system
    if (this.onTimeEvent) {
      this.onTimeEvent(eventName, data);
    }
  }

  // Debug utilities
  debug(): void {
    console.table(this.getPerformanceReport());
    console.log("Time Effects:", Array.from(this.timeEffects.keys()));
    console.log("Scheduled Events:", this.scheduledEvents.size);
  }

  // Cleanup
  destroy(): void {
    this.tweenTimeline.kill();
    this.scheduledEvents.clear();
    this.timeEffects.clear();
  }
}

// Create a singleton instance
const timeManager = new TimeManager();

// Export both the instance and the class
export { timeManager, TimeManager };
