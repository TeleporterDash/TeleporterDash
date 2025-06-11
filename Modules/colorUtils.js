// Modules/colorUtils.js

// TODO: make a overall file JSDoc

/**
 * Convert Hex colors to RGB
 * @param {string} hex - Hex color
 * @returns {Array} - Converted color
 */
export function hexToRGB(hex) {
  hex = hex.replace("#", "")
  const bigint = Number.parseInt(hex, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  }
}

/**
 * Convert RGB colors to Hex
 * @param {number} r - Red value
 * @param {number} g - Green value
 * @param {number} b - Blue value
 * @returns {string} - Converted color as hex
 */
export function rgbToHex(r, g, b) {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, "0")}`
}

/**
 * Convert Hex colors to HSL
 * @param {string} hex - Hex color
 * @returns {Array} - Converted color as HSL
 */
export function hexToHSL(hex) {
  const { r, g, b } = hexToRGB(hex)
  const rNorm = r / 255,
    gNorm = g / 255,
    bNorm = b / 255
  const max = Math.max(rNorm, gNorm, bNorm)
  const min = Math.min(rNorm, gNorm, bNorm)
  let h,
    s,
    l = (max + min) / 2

  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
        break
      case gNorm:
        h = (bNorm - rNorm) / d + 2
        break
      case bNorm:
        h = (rNorm - gNorm) / d + 4
        break
    }
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

/**
 * Convert HSL colors to Hex
 * @param {number} h - hue
 * @param {number} s - saturation
 * @param {number} l - light
 * @returns {string} - Converted color as hex
 */
export function hslToHex(h, s, l) {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0,
    g = 0,
    b = 0

  if (0 <= h && h < 60) {
    r = c
    g = x
    b = 0
  } else if (h < 120) {
    r = x
    g = c
    b = 0
  } else if (h < 180) {
    r = 0
    g = c
    b = x
  } else if (h < 240) {
    r = 0
    g = x
    b = c
  } else if (h < 300) {
    r = x
    g = 0
    b = c
  } else if (h < 360) {
    r = c
    g = 0
    b = x
  }

  r = Math.round((r + m) * 255)
  g = Math.round((g + m) * 255)
  b = Math.round((b + m) * 255)
  return rgbToHex(r, g, b)
}

/**
 * Blend two colors together with customizable intensity
 * @param {string} color1 - first color as hex
 * @param {string} color2 - second color as hex
 * @param {number} intensity - color intensity
 * @returns {Array} - Converted color as RGB
 */
export function blendColors(color1, color2, intensity) {
  const { r: r1, g: g1, b: b1 } = hexToRGB(color1)
  const { r: r2, g: g2, b: b2 } = hexToRGB(color2)
  const r = Math.round(r1 + (r2 - r1) * intensity)
  const g = Math.round(g1 + (g2 - g1) * intensity)
  const b = Math.round(b1 + (b2 - b1) * intensity)
  return rgbToHex(r, g, b)
}

// TODO: find out what this does and make a JSDoc for it
export function hexToNumber(hex) {
  if (!hex || typeof hex !== "string") return 0
  return Number.parseInt(hex.replace("#", ""), 16)
}
