import { blendColors, hexToHSL, hslToHex } from "./colorUtils";
import { debug, error, verbose, warn } from "./logManager";
import { Assets, Sprite, Texture } from "pixi.js";
import type { IDestroyOptions } from "@pixi/display";

const MODULE_NAME = "spriteManager";
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const BASE_COLOR_FALLBACK = "#888";

const BLOCK_IDS = Array.from({ length: 26 }, (_, index) => index);

const COLOR_MAP: Record<string, string> = {
  "0": "#000000",
  "-1": "#ff6b6b",
  "-2": "#4ecdc4",
  "-3": "#45b7d1",
  "-4": "#96ceb4",
  "-5": "#ff9f1c",
  "-6": "#ffbe0b",
  "-7": "#ff006e",
  "-8": "#8338ec",
  "-9": "#3a86ff",
};

export interface SpriteDefinition {
  assetId: string;
  svg: string;
}

export type SpriteMap = Map<string, SpriteDefinition>;

export interface SpriteColorData {
  base?: string;
  tint?: string;
  tintIntensity?: number | string;
  skipColorize?: boolean;
  [key: string]: string | number | boolean | undefined;
}

type ManagedSprite = Sprite & { assetId?: string };

interface AssetCandidate {
  alias: string;
  src: string;
}

type DestroyParams = boolean | IDestroyOptions | undefined;

type BufferEncoding = "utf8" | "utf-8" | "base64";

type BufferFactory = {
  from(
    input: string,
    encoding?: BufferEncoding
  ): { toString(encoding: BufferEncoding): string };
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const encodeSvgToDataUrl = (svg: string): string => {
  if (typeof btoa === "function") {
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  const bufferCtor = (globalThis as { Buffer?: BufferFactory }).Buffer;
  if (bufferCtor) {
    const base64 = bufferCtor.from(svg, "utf8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  }

  throw new Error("No base64 encoder available in this environment");
};

const requestSvg = (path: string): Promise<string> => {
  if (typeof fetch === "function") {
    return fetch(path).then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const svg = await response.text();
      if (!svg.trim()) {
        throw new Error("Empty SVG response");
      }
      return svg;
    });
  }

  if (typeof XMLHttpRequest !== "undefined") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", path, true);
      xhr.overrideMimeType("image/svg+xml");
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status === 0 || xhr.status === 200) {
            const svg = xhr.responseText;
            if (svg && svg.trim()) {
              resolve(svg);
              return;
            }
            reject(new Error("Empty SVG response"));
            return;
          }
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send();
    });
  }

  return Promise.reject(new Error("No supported HTTP client available"));
};

const loadSvgWithRetry = async (
  path: string,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
): Promise<string | null> => {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    verbose(
      MODULE_NAME,
      `Loading SVG from ${path} (attempt ${attempt}/${retries})`
    );
    try {
      const svg = await requestSvg(path);
      debug(MODULE_NAME, `Successfully loaded SVG from ${path}`);
      return svg;
    } catch (exception) {
      error(
        MODULE_NAME,
        `Failed to load SVG for ${path} (attempt ${attempt})`,
        exception
      );
      if (attempt < retries) {
        debug(
          MODULE_NAME,
          `Retrying load for ${path} (${attempt + 1}/${retries})`
        );
        await delay(retryDelayMs);
      }
    }
  }

  error(
    MODULE_NAME,
    `Failed to load SVG for ${path} after ${retries} attempts`
  );
  return null;
};

const createFallbackPlayerSvg =
  (): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <rect width="100" height="100" fill="#ffffff" />
  <rect x="30" y="30" width="40" height="40" fill="#ff6b6b" />
</svg>`;

const createFallbackFloorSvg =
  (): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <rect data-fillable="true" width="100" height="100" fill="#888888" />
</svg>`;

const ensureAssetsPreloaded = async (
  assets: readonly AssetCandidate[]
): Promise<void> => {
  for (const asset of assets) {
    if (Assets.cache.has(asset.alias)) {
      continue;
    }

    try {
      await Assets.load(asset);
    } catch (exception) {
      error(MODULE_NAME, `Failed to preload asset ${asset.alias}`, exception);
    }
  }
};

const ensureTextureCached = async (
  assetId: string,
  svg?: string
): Promise<Texture | null> => {
  try {
    if (!Assets.cache.has(assetId)) {
      if (!svg) {
        error(
          MODULE_NAME,
          `Asset ${assetId} missing and no SVG provided to regenerate it`
        );
        return null;
      }
      await Assets.load({ alias: assetId, src: encodeSvgToDataUrl(svg) });
    }

    const texture = Assets.get<Texture>(assetId);
    if (!texture) {
      error(MODULE_NAME, `Texture ${assetId} not found in PixiJS Assets cache`);
      return null;
    }
    return texture;
  } catch (exception) {
    error(MODULE_NAME, `Failed to ensure texture for ${assetId}`, exception);
    return null;
  }
};

const sanitizeKeyFragment = (
  value: string | number | boolean | undefined
): string => String(value ?? "none").replace(/[^0-9a-zA-Z]+/g, "_");

const createColoredAssetId = (
  baseAssetId: string,
  baseColor: string,
  colorData: SpriteColorData
): string => {
  const tint = typeof colorData.tint === "string" ? colorData.tint : "0";
  const tintIntensity =
    Number.parseFloat(String(colorData.tintIntensity ?? 0)) || 0;
  const intensityFragment = sanitizeKeyFragment(tintIntensity.toFixed(3));
  return `${baseAssetId}_colored_${sanitizeKeyFragment(
    baseColor
  )}_${sanitizeKeyFragment(tint)}_${intensityFragment}`;
};

const shouldUnloadTextures = (options: DestroyParams): boolean => {
  if (typeof options === "boolean") {
    return options;
  }
  return Boolean(options?.texture);
};

const shouldDestroyTexture = (options: DestroyParams): boolean => {
  if (typeof options === "boolean") {
    return options;
  }
  return Boolean(options?.texture);
};

type PixiGlobal = { utils?: { TextureCache?: Record<string, unknown> } };

const getPixiTextureCache = (): Record<string, unknown> | null => {
  const globalObject = globalThis as { PIXI?: PixiGlobal };
  return globalObject?.PIXI?.utils?.TextureCache ?? null;
};

const unloadAsset = (assetId: string): void => {
  if (typeof Assets.unload === "function") {
    void Assets.unload(assetId);
    return;
  }

  const textureCache = getPixiTextureCache();
  if (textureCache && assetId in textureCache) {
    delete textureCache[assetId];
  }
};

const attachManagedDestroy = (
  sprite: ManagedSprite,
  texture: Texture,
  assetId: string
): void => {
  const originalDestroy = sprite.destroy.bind(sprite);

  sprite.destroy = (options?: DestroyParams) => {
    try {
      if (shouldUnloadTextures(options)) {
        debug(MODULE_NAME, `Unloading asset from cache: ${assetId}`);
        unloadAsset(assetId);
      }

      if (shouldDestroyTexture(options)) {
        texture.destroy(true);
      }
    } catch (exception) {
      error(MODULE_NAME, "Error during sprite cleanup:", exception);
    }

    originalDestroy(options);
  };
};

const createManagedSprite = async (
  assetId: string,
  svg: string,
  anchor?: number
): Promise<ManagedSprite | null> => {
  const texture = await ensureTextureCached(assetId, svg);
  if (!texture) {
    return null;
  }

  const sprite = new Sprite(texture) as ManagedSprite;
  if (typeof anchor === "number") {
    sprite.anchor.set(anchor);
  }
  sprite.assetId = assetId;
  attachManagedDestroy(sprite, texture, assetId);
  return sprite;
};

const ensureRequiredSprite = (
  type: "player" | "floor",
  spriteMap: SpriteMap,
  assets: AssetCandidate[]
): void => {
  if (spriteMap.has(type)) {
    return;
  }

  warn(
    MODULE_NAME,
    `Missing required sprite after loading: ${type}, creating fallback`
  );
  const svg =
    type === "player" ? createFallbackPlayerSvg() : createFallbackFloorSvg();
  const assetId = type;
  spriteMap.set(type, { assetId, svg });
  assets.push({ alias: assetId, src: encodeSvgToDataUrl(svg) });
};

const resolvePaletteColor = (value: string): string => {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return COLOR_MAP[trimmed] ?? trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseTintIntensity = (value: number | string | undefined): number => {
  const numericValue = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const getDomParser = (): DOMParser | null => {
  if (typeof DOMParser === "undefined") {
    return null;
  }
  return new DOMParser();
};

export async function loadSprites(directory: string): Promise<SpriteMap> {
  debug(MODULE_NAME, `Loading sprites from directory: ${directory}`);
  const spriteMap: SpriteMap = new Map();
  const assetCandidates: AssetCandidate[] = [];

  await Promise.all(
    BLOCK_IDS.map(async (id) => {
      const path = `${directory}/block_${id}.svg`;
      const svg = await loadSvgWithRetry(path);
      if (!svg) {
        warn(MODULE_NAME, `Failed to load block_${id}.svg`);
        return;
      }

      const assetId = `block_${id}`;
      spriteMap.set(String(id), { assetId, svg });
      assetCandidates.push({ alias: assetId, src: encodeSvgToDataUrl(svg) });
    })
  );

  const playerPath = `${directory}/player.svg`;
  const playerSvg = await loadSvgWithRetry(playerPath);
  if (playerSvg) {
    const assetId = "player";
    spriteMap.set("player", { assetId, svg: playerSvg });
    assetCandidates.push({
      alias: assetId,
      src: encodeSvgToDataUrl(playerSvg),
    });
  } else {
    warn(MODULE_NAME, "Failed to load player sprite, creating fallback");
    const fallback = createFallbackPlayerSvg();
    spriteMap.set("player", { assetId: "player", svg: fallback });
    assetCandidates.push({
      alias: "player",
      src: encodeSvgToDataUrl(fallback),
    });
  }

  const floorPath = `${directory}/floor.svg`;
  const floorSvg = await loadSvgWithRetry(floorPath);
  if (floorSvg) {
    const assetId = "floor";
    spriteMap.set("floor", { assetId, svg: floorSvg });
    assetCandidates.push({ alias: assetId, src: encodeSvgToDataUrl(floorSvg) });
  } else {
    warn(MODULE_NAME, "Failed to load floor.svg, creating fallback");
    const fallback = createFallbackFloorSvg();
    spriteMap.set("floor", { assetId: "floor", svg: fallback });
    assetCandidates.push({ alias: "floor", src: encodeSvgToDataUrl(fallback) });
  }

  ensureRequiredSprite("floor", spriteMap, assetCandidates);
  ensureRequiredSprite("player", spriteMap, assetCandidates);

  await ensureAssetsPreloaded(assetCandidates);

  debug(MODULE_NAME, "Loaded sprites:", Array.from(spriteMap.keys()));
  return spriteMap;
}

export async function getFloorSprite(
  spriteMap: SpriteMap
): Promise<ManagedSprite | null> {
  debug(MODULE_NAME, "Getting floor sprite...");
  const spriteData = spriteMap.get("floor");
  if (!spriteData) {
    warn(MODULE_NAME, "No floor sprite data found in spriteMap");
    return null;
  }

  const sprite = await createManagedSprite(spriteData.assetId, spriteData.svg);
  if (!sprite) {
    error(MODULE_NAME, "Failed to create floor sprite");
    return null;
  }

  debug(MODULE_NAME, "Successfully created floor sprite");
  return sprite;
}

export async function getSprite(
  type: string | number,
  spriteMap: SpriteMap,
  colorData: SpriteColorData = {}
): Promise<ManagedSprite | null> {
  const spriteData = spriteMap.get(String(type));
  if (!spriteData) {
    warn(MODULE_NAME, `No sprite data found for type ${String(type)}`);
    return null;
  }

  if (colorData.skipColorize) {
    return createManagedSprite(spriteData.assetId, spriteData.svg, 0.5);
  }

  const baseColor =
    typeof colorData.base === "string" ? colorData.base : BASE_COLOR_FALLBACK;
  const coloredSvg = colorizeSVG(spriteData.svg, baseColor, colorData);
  const coloredAssetId = createColoredAssetId(
    spriteData.assetId,
    baseColor,
    colorData
  );
  return createManagedSprite(coloredAssetId, coloredSvg, 0.5);
}

export async function getPlayerSprite(
  spriteMap: SpriteMap,
  color = "#ffffff"
): Promise<ManagedSprite | null> {
  debug(MODULE_NAME, "Starting getPlayerSprite...");
  const spriteData = spriteMap.get("player");
  if (!spriteData) {
    error(MODULE_NAME, "No player sprite data found in spriteMap");
    return null;
  }

  const colorOptions: SpriteColorData = {
    base: color,
    tint: "0",
    tintIntensity: 0,
  };
  const coloredSvg = colorizeSVG(spriteData.svg, color, colorOptions);
  const assetId = `player_colored_${sanitizeKeyFragment(color)}`;
  const sprite = await createManagedSprite(assetId, coloredSvg, 0.5);
  if (sprite) {
    debug(MODULE_NAME, "Successfully created player sprite");
  }
  return sprite;
}

export function colorizeSVG(
  svgString: string,
  color: string,
  colorData: SpriteColorData
): string {
  let coloredSvg = svgString;

  try {
    if (
      !svgString ||
      typeof svgString !== "string" ||
      svgString.trim() === ""
    ) {
      throw new Error("Invalid SVG: empty or not a string");
    }

    const parser = getDomParser();
    if (!parser) {
      throw new Error("DOMParser is not available in this environment");
    }

    const documentNode = parser.parseFromString(svgString, "image/svg+xml");
    const parseErrorNode = documentNode.querySelector("parsererror");
    if (parseErrorNode) {
      throw new Error(
        `Invalid SVG: XML parsing error - ${
          parseErrorNode.textContent ?? "unknown"
        }`
      );
    }

    const fillableElements = Array.from(
      documentNode.querySelectorAll<SVGElement>('[data-fillable="true"]')
    );

    const baseColorCandidate =
      color === BASE_COLOR_FALLBACK
        ? colorData.base ?? BASE_COLOR_FALLBACK
        : color;
    const mainColor = resolvePaletteColor(baseColorCandidate);

    const tintColor = typeof colorData.tint === "string" ? colorData.tint : "0";
    const tintIntensity = parseTintIntensity(colorData.tintIntensity);

    let finalColor = mainColor;
    if (tintColor !== "0" && tintIntensity > 0) {
      finalColor = blendColors(
        mainColor,
        resolvePaletteColor(tintColor),
        tintIntensity
      );
    }

    const { h, s, l } = hexToHSL(finalColor);
    const borderColor = hslToHex(h, s, Math.max(l - 30, 0));
    const innerColor = hslToHex(h, s * 0.5, Math.min(l + 30, 100));

    fillableElements.forEach((element) => {
      const tagName = element.tagName.toLowerCase();
      const fillValue = element.getAttribute("fill");

      if (tagName === "stop" && element.hasAttribute("stop-color")) {
        element.setAttribute("stop-color", finalColor);
        return;
      }

      if (
        (tagName === "circle" || tagName === "ellipse") &&
        fillValue === "none" &&
        element.hasAttribute("stroke")
      ) {
        element.setAttribute("stroke", borderColor);
        return;
      }

      if (
        (tagName === "circle" || tagName === "ellipse") &&
        fillValue &&
        !fillValue.startsWith("url(")
      ) {
        element.setAttribute("fill", innerColor);
        return;
      }

      if (fillValue && !fillValue.startsWith("url(")) {
        element.setAttribute("fill", finalColor);
      }
    });

    const serializer = new XMLSerializer();
    coloredSvg = serializer.serializeToString(documentNode.documentElement);
  } catch (exception) {
    warn(MODULE_NAME, "colorizeSVG failed:", exception);
  }

  return coloredSvg;
}
