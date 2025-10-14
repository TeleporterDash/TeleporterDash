// Modules/matrixParser.js
class MatrixParser {
  // Validation regex and constants
  static #alphanumericRegex = /^[A-Za-z0-9]{5}$/
  static #hexColorRegex = /^#[0-9A-Fa-f]{6}$/
  static #rotationRegex = /^@-?\d+$/
  static #validCollisionTypes = ["solid", "passthrough", "sticky", "hazard", "trigger"]
  static #validDistortionTypes = ["wave", "ripple", "twist", "0"]
  static #validBlendModes = ["normal", "add", "multiply", "screen"]
  static #validParticleTypes = ["sparkle", "smoke", "0"]
  static #validSyncTypes = ["beat", "timer", "0"]
  static #validModifierTypes = [21, 22, 23, 24, 25] // Zoom, Shake, Tilt, Pan, Time Warp

  // Default values
  static #defaults = {
    I: "0",
    T: null,
    TR: { rotation: 0, scale: 1.0, flip: "0" },
    AP: {
      color: { base: "#888", tint: "0", tintIntensity: 0, shiftRate: 0, pulseColor: "0", pulseRate: 0 },
      glowColor: "0",
      glowIntensity: 0,
      shadowColor: "0",
      shadowSize: 0,
      depthOffset: 0,
      opacity: 1.0,
      distortionType: "0",
      distortionIntensity: 0,
      blendMode: "normal",
      particleType: "0",
      particleIntensity: 0,
    },
    L: 0,
    CT: null,
    G: 0,
    LK: "0",
    AN: { pulseRate: 0, pulseAmplitude: 0, syncType: "0" },
  }

  // Parse the entire matrix
  static parse(matrix) {
    if (!Array.isArray(matrix)) {
      throw new Error("Matrix must be an array")
    }
    const parsedMatrix = matrix.map((row, rowIndex) => {
      if (!Array.isArray(row)) {
        throw new Error(`Row ${rowIndex} must be an array`)
      }
      return row.map((cell, colIndex) => {
        try {
          return this.#parseCell(cell)
        } catch (error) {
          throw new Error(`Error in cell [${rowIndex},${colIndex}]: ${error.message}`)
        }
      })
    })
    return parsedMatrix
  }

  // Parse a single cell
  static #parseCell(cell) {
    if (cell === 0 || cell === "0") {
      return null
    }

    // Handle modifier syntax: M:21[param1=value1|param2=value2]
    if (typeof cell === "string" && cell.startsWith("M:")) {
      return this.#parseModifier(cell)
    }

    if (typeof cell === "number" || (typeof cell === "string" && /^\d+$/.test(cell))) {
      cell = `T:${cell}`
      console.log("legacy numeric cell converted:", { cell })
    }

    if (typeof cell !== "string") {
      throw new Error(`Cell must be a string or number, got: ${typeof cell}`)
    }

    const parts = cell.includes("/") ? cell.split("/") : [cell]
    const properties = parts.reduce((acc, prop) => {
      const firstColonIndex = prop.indexOf(":")
      if (firstColonIndex === -1) {
        throw new Error(`Invalid property format: ${prop}`)
      }
      const key = prop.slice(0, firstColonIndex)
      const value = prop.slice(firstColonIndex + 1)
      if (!key || !value) {
        throw new Error(`Invalid property format: ${prop}`)
      }
      acc[key] = value
      return acc
    }, {})

    if (!properties.T) {
      throw new Error("Missing required T: property")
    }
    if (!/^\d+$/.test(properties.T)) {
      throw new Error(`Invalid T: value: ${properties.T}`)
    }

    const result = {
      id: this.#defaults.I,
      type: Number.parseInt(properties.T, 10),
      transform: { ...this.#defaults.TR },
      appearance: { ...this.#defaults.AP, color: { ...this.#defaults.AP.color } },
      layer: this.#defaults.L,
      collision: this.#defaults.CT,
      group: this.#defaults.G,
      lock: this.#defaults.LK,
      animation: { ...this.#defaults.AN },
    }

    // Default collision based on type
    if (this.#validModifierTypes.includes(result.type)) {
      result.collision = "passthrough"
      result.isModifier = true
      result.isTrigger = false
    } else if ([3, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 5, 6].includes(result.type)) {
      result.collision = "trigger"
      result.isTrigger = true
      result.isModifier = false
    } else if (result.type === 2) {
      result.collision = "hazard"
      result.isTrigger = false
      result.isModifier = false
    } else {
      result.collision = "solid"
      result.isTrigger = false
      result.isModifier = false
    }

    for (const [key, value] of Object.entries(properties)) {
      switch (key) {
        case "I":
          if (!this.#alphanumericRegex.test(value)) {
            throw new Error(`Invalid I: value: ${value}`)
          }
          result.id = value
          break
        case "T":
          break
        case "TR":
          result.transform = this.#parseTransform(value)
          break
        case "AP":
          result.appearance = this.#parseAppearance(value)
          break
        case "L":
          if (!/^\d+$/.test(value)) {
            throw new Error(`Invalid L: value: ${value}`)
          }
          result.layer = Number.parseInt(value, 10)
          break
        case "CT":
          if (!this.#validCollisionTypes.includes(value)) {
            throw new Error(`Invalid CT: value: ${value}`)
          }
          result.collision = value
          break
        case "G":
          if (!/^\d+$/.test(value)) {
            new Error(`Invalid G: value: ${value}`)
          }
          result.group = Number.parseInt(value, 10)
          break
        case "LK":
          if (value !== "off" && value !== "0" && value !== "unlock") {
            throw new Error(`Invalid LK: value: ${value}`)
          }
          if ((value === "off" || value === "unlock") && result.group === 0) {
            throw new Error("LK:off and LK:unlock require a non-zero G: value")
          }
          result.lock = value
          break
        case "AN":
          result.animation = this.#parseAnimation(value)
          break
        default:
          throw new Error(`Unknown property: ${key}`)
      }
    }

    return result
  }

  static #parseTransform(value) {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid TR: format: ${value}`)
    }
    const parts = value.slice(1, -1).split("|")
    if (parts.length !== 3) {
      throw new Error(`TR: must have 3 parts: ${value}`)
    }
    const [rotation, scale, flip] = parts

    if (!this.#rotationRegex.test(rotation)) {
      throw new Error(`Invalid TR rotation: ${rotation}`)
    }
    if (!/^\d*\.?\d+$/.test(scale)) {
      throw new Error(`Invalid TR scale: ${scale}`)
    }
    if (!["h", "v", "hv", "0"].includes(flip)) {
      throw new Error(`Invalid TR flip: ${flip}`)
    }

    return {
      rotation: Number.parseInt(rotation.slice(1), 10),
      scale: Number.parseFloat(scale),
      flip,
    }
  }

  static #parseAppearance(value) {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid AP: format: ${value}`)
    }

    const colorMatch = value.match(/C:\[[^\]]+\]/)
    if (!colorMatch) {
      throw new Error(`Invalid AP color format: ${value}`)
    }
    const colorStr = colorMatch[0]

    const remaining = value
      .slice(1, -1)
      .replace(colorStr, "")
      .replace(/^\|+|\|+$/g, "")
    const otherParts = remaining ? remaining.split("|") : []

    const paddedParts = otherParts.concat(Array(16 - otherParts.length).fill("0"))
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
    ] = paddedParts

    if (!colorStr.startsWith("C:[") || !colorStr.endsWith("]")) {
      throw new Error(`Invalid AP color format: ${colorStr}`)
    }
    const colorParts = colorStr.slice(3, -1).split("|")
    if (colorParts.length !== 6) {
      throw new Error(`AP color must have 6 parts: ${colorStr}`)
    }
    const [base, tint, tintIntensity, shiftRate, pulseColor, pulseRate] = colorParts

    if (base !== "0" && !this.#hexColorRegex.test(base)) {
      throw new Error(`Invalid AP color base: ${base}`)
    }
    if (tint !== "0" && !this.#hexColorRegex.test(tint)) {
      throw new Error(`Invalid AP color tint: ${tint}`)
    }
    if (tintIntensity !== "0" && !/^\d*\.?\d+$/.test(tintIntensity)) {
      throw new Error(`Invalid AP tint intensity: ${tintIntensity}`)
    }
    if (shiftRate !== "0" && !/^\d*\.?\d+$/.test(shiftRate)) {
      throw new Error(`Invalid AP color shift rate: ${shiftRate}`)
    }
    if (pulseColor !== "0" && !this.#hexColorRegex.test(pulseColor)) {
      throw new Error(`Invalid AP pulse color: ${pulseColor}`)
    }
    if (pulseRate !== "0" && !/^\d*\.?\d+$/.test(pulseRate)) {
      throw new Error(`Invalid AP pulse rate: ${pulseRate}`)
    }
    if (glowColor !== "0" && !this.#hexColorRegex.test(glowColor)) {
      throw new Error(`Invalid AP glow color: ${glowColor}`)
    }
    if (glowIntensity !== "0" && !/^\d*\.?\d+$/.test(glowIntensity)) {
      throw new Error(`Invalid AP glow intensity: ${glowIntensity}`)
    }
    if (shadowColor !== "0" && !this.#hexColorRegex.test(shadowColor)) {
      throw new Error(`Invalid AP shadow color: ${shadowColor}`)
    }
    if (shadowSize !== "0" && !/^\d*\.?\d+$/.test(shadowSize)) {
      throw new Error(`Invalid AP shadow size: ${shadowSize}`)
    }
    if (depthOffset !== "0" && !/^\d*\.?\d+$/.test(depthOffset)) {
      throw new Error(`Invalid AP depth offset: ${depthOffset}`)
    }
    if (opacity !== "0" && !/^\d*\.?\d+$/.test(opacity)) {
      throw new Error(`Invalid AP opacity: ${opacity}`)
    }
    if (!this.#validDistortionTypes.includes(distortionType)) {
      throw new Error(`Invalid AP distortion type: ${distortionType}`)
    }
    if (distortionIntensity !== "0" && !/^\d*\.?\d+$/.test(distortionIntensity)) {
      throw new Error(`Invalid AP distortion intensity: ${distortionIntensity}`)
    }
    if (!this.#validBlendModes.includes(blendMode)) {
      throw new Error(`Invalid AP blend mode: ${blendMode}`)
    }
    if (!this.#validParticleTypes.includes(particleType)) {
      throw new Error(`Invalid AP particle type: ${particleType}`)
    }
    if (particleIntensity !== "0" && !/^\d*\.?\d+$/.test(particleIntensity)) {
      throw new Error(`Invalid AP particle intensity: ${particleIntensity}`)
    }

    const parsedGlowIntensity = Number.parseFloat(glowIntensity) || 0
    const parsedShadowSize = Number.parseFloat(shadowSize) || 0
    const parsedDistortionIntensity = Number.parseFloat(distortionIntensity) || 0
    const parsedParticleIntensity = Number.parseFloat(particleIntensity) || 0

    if (parsedGlowIntensity < 0) {
      throw new Error(`AP glow intensity must be non-negative: ${glowIntensity}`)
    }
    if (parsedShadowSize < 0) {
      throw new Error(`AP shadow size must be non-negative: ${shadowSize}`)
    }
    if (parsedDistortionIntensity < 0) {
      throw new Error(`AP distortion intensity must be non-negative: ${distortionIntensity}`)
    }
    if (parsedParticleIntensity < 0) {
      throw new Error(`AP particle intensity must be non-negative: ${particleIntensity}`)
    }

    return {
      color: {
        base: base === "0" ? "#888" : base,
        tint: tint,
        tintIntensity: Number.parseFloat(tintIntensity) || 0,
        shiftRate: Number.parseFloat(shiftRate) || 0,
        pulseColor: pulseColor,
        pulseRate: Number.parseFloat(pulseRate) || 0,
      },
      glowColor: glowColor === "0" ? "#888" : glowColor,
      glowIntensity: parsedGlowIntensity,
      shadowColor: shadowColor === "0" ? "#888" : shadowColor,
      shadowSize: parsedShadowSize,
      depthOffset: Number.parseFloat(depthOffset) || 0,
      opacity: Number.parseFloat(opacity) || 1.0,
      distortionType: distortionType,
      distortionIntensity: parsedDistortionIntensity,
      blendMode: blendMode,
      particleType: particleType,
      particleIntensity: parsedParticleIntensity,
    }
  }

  static #parseAnimation(value) {
    if (!value.startsWith("[") || !value.endsWith("]")) {
      throw new Error(`Invalid AN: format: ${value}`)
    }
    const parts = value.slice(1, -1).split("|")
    if (parts.length !== 3) {
      throw new Error(`AN: must have 3 parts: ${value}`)
    }
    const [pulseRate, pulseAmplitude, syncType] = parts

    if (pulseRate !== "0" && !/^\d*\.?\d+$/.test(pulseRate)) {
      throw new Error(`Invalid AN pulse rate: ${pulseRate}`)
    }
    if (pulseAmplitude !== "0" && !/^\d*\.?\d+$/.test(pulseAmplitude)) {
      throw new Error(`Invalid AN pulse amplitude: ${pulseAmplitude}`)
    }
    if (!this.#validSyncTypes.includes(syncType)) {
      throw new Error(`Invalid AN sync type: ${syncType}`)
    }

    return {
      pulseRate: Number.parseFloat(pulseRate) || 0,
      pulseAmplitude: Number.parseFloat(pulseAmplitude) || 0,
      syncType,
    }
  }

  static #parseModifier(cell) {
    // Match M:type[params]
    const match = cell.match(/^M:(\d+)\[(.*?)\]$/)
    if (!match) {
      throw new Error(`Invalid modifier format: ${cell}`)
    }

    const type = Number.parseInt(match[1], 10)
    if (!this.#validModifierTypes.includes(type)) {
      throw new Error(`Invalid modifier type: ${type}. Must be one of: ${this.#validModifierTypes.join(", ")}`)
    }

    const paramString = match[2]
    const params = {}

    // Parse parameters
    paramString.split("|").forEach((param) => {
      const [key, value] = param.split("=")
      if (key && value !== undefined) {
        // Convert to number if possible
        params[key] = isNaN(value) ? value : Number.parseFloat(value)
      }
    })

    // Set up the modifier object
    return {
      type: "modifier",
      modifierType: type,
      params,
      collision: "passthrough", // Changed from 'trigger'
      isModifier: true, // New flag
      isTrigger: false, // Explicitly not a trigger
    }
  }

  static shouldSkipRendering(cell, isEditor = false) {
    if (isEditor) return false
    return cell?.isTrigger || cell?.isModifier
  }

  static shouldSkipCollision(cell, isEditor = false) {
    if (isEditor) return false
    return cell?.isTrigger || cell?.collision === "passthrough"
  }
}

export { MatrixParser }
