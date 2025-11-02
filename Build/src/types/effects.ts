import type { DisplacementFilter, NoiseFilter } from "pixi.js";
import type { ShockwaveFilter, TwistFilter } from "pixi-filters";

export type DistortionType =
  | "wave"
  | "ripple"
  | "twist"
  | "noise"
  | "displacement";

export interface DistortionConfig {
  amplitude?: number;
  speed?: number;
  radius?: number;
  wavelength?: number;
  brightness?: number;
  angle?: number;
  seed?: number;
  noise?: number;
  scale?: number;
}

export type DistortionFilterInstance =
  | ShockwaveFilter
  | TwistFilter
  | NoiseFilter
  | DisplacementFilter;

export type ParticleType = "sparkle" | "wave" | "shock" | "explosion" | "magic";

export interface ParticleConfig {
  scale: { start: number; end: number };
  color: { start: string; end: string };
  speed: { x: number; y: number };
  life: number;
  size: number;
  ease: string;
  count: number;
}

export interface ParticleSystemOptions {
  zIndex?: number;
  maxParticles?: number;
  poolSize?: number;
}

export interface EmitOptions {
  color?: string | null;
  spread?: number;
}

export interface ExplosionOptions {
  color?: string;
  count?: number;
  maxRadius?: number;
  duration?: number;
  intensity?: number;
  colors?: string[] | null;
}

export interface AppearanceColor {
  base: string;
  tint: string;
  tintIntensity: number;
  shiftRate: number;
  pulseColor: string;
  pulseRate: number;
}

export interface AppearanceConfig {
  color: AppearanceColor;
  glowColor: string;
  glowIntensity: number;
  shadowColor: string;
  shadowSize: number;
  depthOffset: number;
  opacity: number;
  distortionType: string;
  distortionIntensity: number;
  blendMode: string;
  particleType: string;
  particleIntensity: number;
}
