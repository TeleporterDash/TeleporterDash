import { debug } from "./logManager";
import { gsap } from "gsap";
import type { Howl } from "howler";
import AudioManager from "./audioManager";

type BeatCallback = (currentTime: number) => void;
type TimerCallback = (currentTime: number) => void;
type PulseCallback = () => void;

interface MusicSyncOptions {
  useHowler?: boolean;
  bpm?: number;
  maxHistory?: number;
  energyThresholdFactor?: number;
}

type HowlWithInternalNode = Howl & {
  _sounds?: Array<{ _node?: HTMLAudioElement | null }>;
};

const DEFAULT_MAX_HISTORY = 43;
const DEFAULT_THRESHOLD_FACTOR = 1.3;

const isHtmlAudioElement = (value: unknown): value is HTMLAudioElement => {
  if (typeof HTMLAudioElement === "undefined") return false;
  return value instanceof HTMLAudioElement;
};

const getMediaElementFromHowl = (
  howl: HowlWithInternalNode | null
): HTMLAudioElement | null => {
  if (!howl?._sounds || howl._sounds.length === 0) {
    return null;
  }
  const node = howl._sounds[0]?._node;
  return node && isHtmlAudioElement(node) ? node : null;
};

export class MusicSync {
  private readonly audioManager: AudioManager;
  private readonly useHowler: boolean;
  private beatCallback: BeatCallback | null = null;
  private timerCallback: TimerCallback | null = null;
  private pulseCallback: PulseCallback | null = null;
  private bpm: number;
  private beatInterval: number;
  private lastBeatTime = 0;
  private readonly energyHistory: number[] = [];
  private readonly maxHistory: number;
  private readonly energyThresholdFactor: number;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Uint8Array<ArrayBuffer> | null = null;
  private audioSource: MediaElementAudioSourceNode | null = null;
  private initialized = false;
  private running = false;
  private animationFrameId: number | null = null;

  constructor(audioManager: AudioManager, options: MusicSyncOptions = {}) {
    this.audioManager = audioManager;
    this.useHowler = options.useHowler ?? true;
    this.bpm = options.bpm ?? 120;
    this.beatInterval = 60 / this.bpm;
    this.maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
    this.energyThresholdFactor =
      options.energyThresholdFactor ?? DEFAULT_THRESHOLD_FACTOR;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const audioContextCtor = this.resolveAudioContextConstructor();
    if (!audioContextCtor) {
      throw new Error("Web Audio API is not available in this environment");
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new audioContextCtor();
        await this.audioContext.resume();
      }

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.buffer = new Uint8Array(
        new ArrayBuffer(this.analyser.frequencyBinCount)
      );

      const mediaElement = this.resolveMediaElement();
      if (!mediaElement) {
        throw new Error("Unable to resolve audio element for MusicSync");
      }

      if (this.audioSource) {
        this.audioSource.disconnect();
      }

      this.audioSource =
        this.audioContext.createMediaElementSource(mediaElement);
      this.audioSource.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      this.initialized = true;
      this.running = true;
      this.startDetectionLoop();

      debug("musicSync", "Initialized successfully");
    } catch (error) {
      console.error("musicSync", "Initialization failed:", error);
      throw error;
    }
  }

  private resolveAudioContextConstructor():
    | (new () => AudioContext)
    | (new () => AudioContext & { resume(): Promise<void> })
    | null {
    if (typeof window === "undefined") {
      return null;
    }

    return (
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ||
      null
    );
  }

  private resolveMediaElement(): HTMLAudioElement | null {
    const backgroundMusic = this.audioManager.backgroundMusic;
    if (!backgroundMusic) {
      return null;
    }

    if (this.useHowler) {
      return getMediaElementFromHowl(backgroundMusic as HowlWithInternalNode);
    }

    return isHtmlAudioElement(backgroundMusic) ? backgroundMusic : null;
  }

  private startDetectionLoop(): void {
    const step = () => {
      if (!this.running || !this.analyser || !this.buffer) {
        return;
      }

      const buffer = this.buffer;
      this.analyser.getByteFrequencyData(buffer);

      const currentEnergy = buffer.reduce((acc, value) => acc + value, 0);
      this.energyHistory.push(currentEnergy);
      if (this.energyHistory.length > this.maxHistory) {
        this.energyHistory.shift();
      }

      const totalEnergy = this.energyHistory.reduce(
        (acc, value) => acc + value,
        0
      );
      const averageEnergy = totalEnergy / this.energyHistory.length;
      const threshold = averageEnergy * this.energyThresholdFactor;

      if (currentEnergy > threshold) {
        this.triggerBeat();
      }

      if (this.timerCallback) {
        const now = this.getCurrentTime();
        const delta = now - this.lastBeatTime;
        if (delta >= this.beatInterval) {
          this.lastBeatTime = now;
          this.timerCallback(now);
        }
      }

      this.animationFrameId = this.requestAnimationFrame(step);
    };

    this.animationFrameId = this.requestAnimationFrame(step);
  }

  private requestAnimationFrame(callback: FrameRequestCallback): number {
    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      return window.requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(performance.now()), 16);
  }

  private cancelAnimationFrame(handle: number): void {
    if (
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
  }

  private triggerBeat(): void {
    const currentTime = this.getCurrentTime();
    this.beatCallback?.(currentTime);
    this.pulseCallback?.();

    gsap.to("body", {
      backgroundColor: "#fff",
      duration: 0.05,
      yoyo: true,
      repeat: 1,
      ease: "power1.inOut",
    });
  }

  setBeatCallback(callback: BeatCallback | null): void {
    this.beatCallback = callback;
  }

  setTimerCallback(callback: TimerCallback | null, interval = 1): void {
    this.timerCallback = callback;
    this.beatInterval = interval;
  }

  setPulseCallback(callback: PulseCallback | null): void {
    this.pulseCallback = callback;
  }

  getCurrentTime(): number {
    const backgroundMusic = this.audioManager.backgroundMusic;
    if (!backgroundMusic) {
      return 0;
    }

    if (this.useHowler) {
      try {
        const position = (backgroundMusic as Howl).seek();
        return typeof position === "number" ? position : 0;
      } catch {
        return 0;
      }
    }

    if (isHtmlAudioElement(backgroundMusic)) {
      return backgroundMusic.currentTime || 0;
    }

    return 0;
  }

  setBPM(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error("BPM must be a positive number");
    }
    this.bpm = bpm;
    this.beatInterval = 60 / bpm;
  }

  getBPM(): number {
    return this.bpm;
  }

  reset(): void {
    this.running = false;

    if (this.animationFrameId !== null) {
      this.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    this.analyser?.disconnect();
    this.analyser = null;
    this.buffer = null;

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    this.energyHistory.length = 0;
    this.initialized = false;
  }
}

export default MusicSync;
