export type CollisionType =
  | "solid"
  | "passthrough"
  | "sticky"
  | "hazard"
  | "trigger";
export type DistortionType = "wave" | "ripple" | "twist" | "0";
export type BlendModeType = "normal" | "add" | "multiply" | "screen";
export type ParticleType = "sparkle" | "smoke" | "0";
export type SyncType = "beat" | "timer" | "0";
export type FlipType = "h" | "v" | "hv" | "0";
export type LockType = "0" | "off" | "unlock";

export interface TransformData {
  rotation: number;
  scale: number;
  flip: FlipType;
}

export interface AppearanceColorData {
  base: string;
  tint: string;
  tintIntensity: number;
  shiftRate: number;
  pulseColor: string;
  pulseRate: number;
}

export interface AppearanceData {
  color: AppearanceColorData;
  glowColor: string;
  glowIntensity: number;
  shadowColor: string;
  shadowSize: number;
  depthOffset: number;
  opacity: number;
  distortionType: DistortionType;
  distortionIntensity: number;
  blendMode: BlendModeType;
  particleType: ParticleType;
  particleIntensity: number;
}

export interface AnimationData {
  pulseRate: number;
  pulseAmplitude: number;
  syncType: SyncType;
}

export interface ParsedTileCell {
  id: string;
  type: number;
  transform: TransformData;
  appearance: AppearanceData;
  layer: number;
  collision: CollisionType;
  group: number;
  lock: LockType;
  animation: AnimationData;
  isTrigger: boolean;
  isModifier: boolean;
}

export type ModifierParamValue = number | string;

export interface ModifierCell {
  type: "modifier";
  modifierType: number;
  params: Record<string, ModifierParamValue>;
  collision: "passthrough";
  isModifier: true;
  isTrigger: false;
}

export type ParsedCell = ParsedTileCell | ModifierCell;
export type ParsedMatrix = (ParsedCell | null)[][];

const DEFAULT_COLOR = "#888";

const MODIFIER_TYPES = new Set([21, 22, 23, 24, 25]);
const TRIGGER_TYPES = new Set([
  3, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
]);

const VALID_COLLISION_TYPES: readonly CollisionType[] = [
  "solid",
  "passthrough",
  "sticky",
  "hazard",
  "trigger",
];
const VALID_DISTORTION_TYPES: readonly DistortionType[] = [
  "wave",
  "ripple",
  "twist",
  "0",
];
const VALID_BLEND_MODES: readonly BlendModeType[] = [
  "normal",
  "add",
  "multiply",
  "screen",
];
const VALID_PARTICLE_TYPES: readonly ParticleType[] = ["sparkle", "smoke", "0"];
const VALID_SYNC_TYPES: readonly SyncType[] = ["beat", "timer", "0"];
const VALID_FLIP_TYPES: readonly FlipType[] = ["h", "v", "hv", "0"];
const VALID_LOCK_TYPES: readonly LockType[] = ["0", "off", "unlock"];

const ALPHANUMERIC_REGEX = /^[A-Za-z0-9]{5}$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const ROTATION_REGEX = /^@-?\d+$/;
const NUMERIC_REGEX = /^\d+$/;
const FLOAT_REGEX = /^\d*\.?\d+$/;

const DEFAULT_TRANSFORM: TransformData = { rotation: 0, scale: 1, flip: "0" };
const DEFAULT_COLOR_DATA: AppearanceColorData = {
  base: DEFAULT_COLOR,
  tint: "0",
  tintIntensity: 0,
  shiftRate: 0,
  pulseColor: "0",
  pulseRate: 0,
};
const DEFAULT_ANIMATION: AnimationData = {
  pulseRate: 0,
  pulseAmplitude: 0,
  syncType: "0",
};

const createDefaultAppearance = (): AppearanceData => ({
  color: { ...DEFAULT_COLOR_DATA },
  glowColor: DEFAULT_COLOR,
  glowIntensity: 0,
  shadowColor: DEFAULT_COLOR,
  shadowSize: 0,
  depthOffset: 0,
  opacity: 1,
  distortionType: "0",
  distortionIntensity: 0,
  blendMode: "normal",
  particleType: "0",
  particleIntensity: 0,
});

const createDefaultTileCell = (type: number): ParsedTileCell => ({
  id: "0",
  type,
  transform: { ...DEFAULT_TRANSFORM },
  appearance: createDefaultAppearance(),
  layer: 0,
  collision: "solid",
  group: 0,
  lock: "0",
  animation: { ...DEFAULT_ANIMATION },
  isTrigger: false,
  isModifier: false,
});

const validateFloat = (value: string, context: string): number => {
  if (value === "0") {
    return 0;
  }
  if (!FLOAT_REGEX.test(value)) {
    throw new Error(`Invalid ${context}: ${value}`);
  }
  return Number.parseFloat(value);
};

const validateHexColor = (value: string, context: string): string => {
  if (value === "0") {
    return DEFAULT_COLOR;
  }
  if (!HEX_COLOR_REGEX.test(value)) {
    throw new Error(`Invalid ${context}: ${value}`);
  }
  return value;
};

export class MatrixParser {
  static parse(matrix: unknown): ParsedMatrix {
    if (!Array.isArray(matrix)) {
      throw new Error("Matrix must be an array");
    }

    return matrix.map((row, rowIndex) => {
      if (!Array.isArray(row)) {
        throw new Error(`Row ${rowIndex} must be an array`);
      }

      return row.map((cell, colIndex) => {
        try {
          return MatrixParser.parseCell(cell);
        } catch (exception) {
          const errorMessage =
            exception instanceof Error ? exception.message : String(exception);
          throw new Error(
            `Error in cell [${rowIndex},${colIndex}]: ${errorMessage}`
          );
        }
      });
    });
  }

  private static parseCell(cell: unknown): ParsedCell | null {
    if (cell === 0 || cell === "0") {
      return null;
    }

    if (typeof cell === "string" && cell.startsWith("M:")) {
      return MatrixParser.parseModifier(cell);
    }

    let normalizedCell = cell;
    if (typeof cell === "number") {
      normalizedCell = `T:${cell}`;
    }

    if (typeof normalizedCell !== "string") {
      throw new Error(
        `Cell must be a string or number, got: ${typeof normalizedCell}`
      );
    }

    if (NUMERIC_REGEX.test(normalizedCell)) {
      normalizedCell = `T:${normalizedCell}`;
    }

    const properties = MatrixParser.parseProperties(normalizedCell as string);

    const typeValue = properties.get("T");
    if (!typeValue) {
      throw new Error("Missing required T: property");
    }
    if (!NUMERIC_REGEX.test(typeValue)) {
      throw new Error(`Invalid T: value: ${typeValue}`);
    }

    const typeNumber = Number.parseInt(typeValue, 10);
    const result = createDefaultTileCell(typeNumber);

    MatrixParser.applyDefaultCollision(result);

    for (const [key, value] of properties.entries()) {
      switch (key) {
        case "I":
          MatrixParser.applyIdentifier(result, value);
          break;
        case "T":
          break;
        case "TR":
          result.transform = MatrixParser.parseTransform(value);
          break;
        case "AP":
          result.appearance = MatrixParser.parseAppearance(value);
          break;
        case "L":
          result.layer = MatrixParser.parseInteger(value, "L");
          break;
        case "CT":
          MatrixParser.applyCollision(result, value);
          break;
        case "G":
          result.group = MatrixParser.parseInteger(value, "G");
          break;
        case "LK":
          MatrixParser.applyLock(result, value);
          break;
        case "AN":
          result.animation = MatrixParser.parseAnimation(value);
          break;
        default:
          throw new Error(`Unknown property: ${key}`);
      }
    }

    return result;
  }

  private static parseProperties(cell: string): Map<string, string> {
    const segments = cell.includes("/") ? cell.split("/") : [cell];
    const properties = new Map<string, string>();

    for (const segment of segments) {
      const firstColonIndex = segment.indexOf(":");
      if (firstColonIndex === -1) {
        throw new Error(`Invalid property format: ${segment}`);
      }

      const key = segment.slice(0, firstColonIndex);
      const value = segment.slice(firstColonIndex + 1);

      if (!key || !value) {
        throw new Error(`Invalid property format: ${segment}`);
      }

      properties.set(key, value);
    }

    return properties;
  }

  private static applyIdentifier(result: ParsedTileCell, value: string): void {
    if (!ALPHANUMERIC_REGEX.test(value)) {
      throw new Error(`Invalid I: value: ${value}`);
    }
    result.id = value;
  }

  private static parseTransform(value: string): TransformData {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid TR: format: ${value}`);
    }

    const [rotation, scale, flip] = value.slice(1, -1).split("|");
    if (rotation === undefined || scale === undefined || flip === undefined) {
      throw new Error(`TR: must have 3 parts: ${value}`);
    }

    if (!ROTATION_REGEX.test(rotation)) {
      throw new Error(`Invalid TR rotation: ${rotation}`);
    }

    if (!FLOAT_REGEX.test(scale)) {
      throw new Error(`Invalid TR scale: ${scale}`);
    }

    if (!VALID_FLIP_TYPES.includes(flip as FlipType)) {
      throw new Error(`Invalid TR flip: ${flip}`);
    }

    return {
      rotation: Number.parseInt(rotation.slice(1), 10),
      scale: Number.parseFloat(scale),
      flip: flip as FlipType,
    };
  }

  private static parseAppearance(value: string): AppearanceData {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid AP: format: ${value}`);
    }

    const colorMatch = value.match(/C:\[[^\]]+\]/);
    if (!colorMatch) {
      throw new Error(`Invalid AP color format: ${value}`);
    }

    const colorString = colorMatch[0];
    const otherSegments = value
      .slice(1, -1)
      .replace(colorString, "")
      .replace(/^[|]+|[|]+$/g, "");
    const otherValues = otherSegments ? otherSegments.split("|") : [];

    const paddedValues = otherValues.concat(
      Array(Math.max(0, 11 - otherValues.length)).fill("0")
    );

    const [
      glowColor,
      glowIntensity,
      shadowColor,
      shadowSize,
      depthOffset,
      opacity,
      distortionType,
      distortionIntensity,
      blendMode = "normal",
      particleType,
      particleIntensity,
    ] = paddedValues as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string
    ];

    const colorParts = colorString.slice(3, -1).split("|");
    if (colorParts.length !== 6) {
      throw new Error(`AP color must have 6 parts: ${colorString}`);
    }

    const [base, tint, tintIntensity, shiftRate, pulseColor, pulseRate] =
      colorParts;

    const appearance: AppearanceData = {
      color: {
        base: validateHexColor(base, "AP color base"),
        tint: tint === "0" ? "0" : validateHexColor(tint, "AP color tint"),
        tintIntensity: validateFloat(tintIntensity, "AP tint intensity"),
        shiftRate: validateFloat(shiftRate, "AP color shift rate"),
        pulseColor:
          pulseColor === "0"
            ? "0"
            : validateHexColor(pulseColor, "AP pulse color"),
        pulseRate: validateFloat(pulseRate, "AP pulse rate"),
      },
      glowColor: validateHexColor(glowColor, "AP glow color"),
      glowIntensity: validateFloat(glowIntensity, "AP glow intensity"),
      shadowColor: validateHexColor(shadowColor, "AP shadow color"),
      shadowSize: validateFloat(shadowSize, "AP shadow size"),
      depthOffset: validateFloat(depthOffset, "AP depth offset"),
      opacity: validateFloat(opacity, "AP opacity"),
      distortionType: MatrixParser.parseEnumValue(
        distortionType,
        VALID_DISTORTION_TYPES,
        "AP distortion type"
      ),
      distortionIntensity: validateFloat(
        distortionIntensity,
        "AP distortion intensity"
      ),
      blendMode: MatrixParser.parseEnumValue(
        blendMode,
        VALID_BLEND_MODES,
        "AP blend mode"
      ),
      particleType: MatrixParser.parseEnumValue(
        particleType,
        VALID_PARTICLE_TYPES,
        "AP particle type"
      ),
      particleIntensity: validateFloat(
        particleIntensity,
        "AP particle intensity"
      ),
    };

    MatrixParser.ensureNonNegative(
      appearance.glowIntensity,
      "AP glow intensity"
    );
    MatrixParser.ensureNonNegative(appearance.shadowSize, "AP shadow size");
    MatrixParser.ensureNonNegative(
      appearance.distortionIntensity,
      "AP distortion intensity"
    );
    MatrixParser.ensureNonNegative(
      appearance.particleIntensity,
      "AP particle intensity"
    );

    return appearance;
  }

  private static parseAnimation(value: string): AnimationData {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid AN: format: ${value}`);
    }

    const parts = value.slice(1, -1).split("|");
    if (parts.length !== 3) {
      throw new Error(`AN: must have 3 parts: ${value}`);
    }

    const [pulseRate, pulseAmplitude, syncType] = parts;

    const animation: AnimationData = {
      pulseRate: validateFloat(pulseRate, "AN pulse rate"),
      pulseAmplitude: validateFloat(pulseAmplitude, "AN pulse amplitude"),
      syncType: MatrixParser.parseEnumValue(
        syncType,
        VALID_SYNC_TYPES,
        "AN sync type"
      ),
    };

    MatrixParser.ensureNonNegative(animation.pulseRate, "AN pulse rate");
    MatrixParser.ensureNonNegative(
      animation.pulseAmplitude,
      "AN pulse amplitude"
    );

    return animation;
  }

  private static parseModifier(cell: string): ModifierCell {
    const match = cell.match(/^M:(\d+)\[(.*?)\]$/);
    if (!match) {
      throw new Error(`Invalid modifier format: ${cell}`);
    }

    const modifierType = Number.parseInt(match[1], 10);
    if (!MODIFIER_TYPES.has(modifierType)) {
      throw new Error(
        `Invalid modifier type: ${modifierType}. Must be one of: ${Array.from(
          MODIFIER_TYPES
        ).join(", ")}`
      );
    }

    const paramString = match[2];
    const params: Record<string, ModifierParamValue> = {};

    if (paramString.trim()) {
      const paramEntries = paramString.split("|");
      for (const entry of paramEntries) {
        const [rawKey, rawValue] = entry.split("=");
        if (!rawKey || rawValue === undefined) {
          throw new Error(`Invalid modifier parameter: ${entry}`);
        }

        const key = rawKey.trim();
        const value = rawValue.trim();
        const numeric = Number.parseFloat(value);
        params[key] = Number.isFinite(numeric) ? numeric : value;
      }
    }

    return {
      type: "modifier",
      modifierType,
      params,
      collision: "passthrough",
      isModifier: true,
      isTrigger: false,
    };
  }

  private static parseInteger(value: string, context: string): number {
    if (!NUMERIC_REGEX.test(value)) {
      throw new Error(`Invalid ${context}: value: ${value}`);
    }
    return Number.parseInt(value, 10);
  }

  private static applyDefaultCollision(cell: ParsedTileCell): void {
    if (MODIFIER_TYPES.has(cell.type)) {
      cell.collision = "passthrough";
      cell.isModifier = true;
      cell.isTrigger = false;
      return;
    }

    if (TRIGGER_TYPES.has(cell.type)) {
      cell.collision = "trigger";
      cell.isTrigger = true;
      cell.isModifier = false;
      return;
    }

    if (cell.type === 2) {
      cell.collision = "hazard";
      cell.isTrigger = false;
      cell.isModifier = false;
      return;
    }

    cell.collision = "solid";
    cell.isTrigger = false;
    cell.isModifier = false;
  }

  private static applyCollision(cell: ParsedTileCell, value: string): void {
    if (!VALID_COLLISION_TYPES.includes(value as CollisionType)) {
      throw new Error(`Invalid CT: value: ${value}`);
    }

    cell.collision = value as CollisionType;
    cell.isTrigger = value === "trigger";
    cell.isModifier = MODIFIER_TYPES.has(cell.type);
  }

  private static applyLock(cell: ParsedTileCell, value: string): void {
    if (!VALID_LOCK_TYPES.includes(value as LockType)) {
      throw new Error(`Invalid LK: value: ${value}`);
    }

    const lockValue = value as LockType;
    if ((lockValue === "off" || lockValue === "unlock") && cell.group === 0) {
      throw new Error("LK:off and LK:unlock require a non-zero G: value");
    }

    cell.lock = lockValue;
  }

  private static parseEnumValue<T extends string>(
    value: string,
    validValues: readonly T[],
    context: string
  ): T {
    if (!validValues.includes(value as T)) {
      throw new Error(`Invalid ${context}: ${value}`);
    }
    return value as T;
  }

  private static ensureNonNegative(value: number, context: string): void {
    if (value < 0) {
      throw new Error(`${context} must be non-negative: ${value}`);
    }
  }

  static shouldSkipRendering(
    cell: ParsedCell | null | undefined,
    isEditor = false
  ): boolean {
    if (isEditor) {
      return false;
    }
    return Boolean(cell?.isTrigger || cell?.isModifier);
  }

  static shouldSkipCollision(
    cell: ParsedCell | null | undefined,
    isEditor = false
  ): boolean {
    if (isEditor) {
      return false;
    }
    return Boolean(cell?.isTrigger || cell?.collision === "passthrough");
  }
}
