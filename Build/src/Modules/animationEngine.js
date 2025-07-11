// Modules/animationEngine.js
import { colorizeSVG } from "./spriteManager.js"
import { blendColors, hslToHex } from "./colorUtils.js"
import { warn, verbose, setLogLevel } from "./logManager.js"
import _ from "lodash"

setLogLevel("debug")

const textureCache = new Map()

export function getTextureCache() {
  return textureCache
}

export function clearTextureCache() {
  textureCache.clear()
}

function generatePulseTextureKey(x, y, base, pulse, step) {
  return `pulse_${x}_${y}_${base}_${pulse}_${step}`
}

function generateShiftTextureKey(x, y, step) {
  return `shift_${x}_${y}_${step}`
}

export function pregenerateTextures(object, x, y) {
  if (!object || !object.appearance?.color) return

  const {
    base,
    tint,
    tintIntensity,
    shiftRate,
    pulseColor,
    pulseRate
  } = object.appearance.color

  const colorData = { base, tint, tintIntensity, shiftRate, pulseColor, pulseRate }

  // Color pulse textures
  if (pulseRate > 0 && pulseColor !== "0") {
    const steps = 20
    for (let step = 0; step < steps; step++) {
      const ratio = step / (steps - 1)
      const cacheKey = generatePulseTextureKey(x, y, base, pulseColor, step)
      if (!textureCache.has(cacheKey)) {
        const blendedColor = blendColors(base, pulseColor, ratio)
        const coloredSvg = colorizeSVG(object.svg, blendedColor, colorData)
        const coloredDataUrl = `data:image/svg+xml;base64,${btoa(coloredSvg)}`
        textureCache.set(cacheKey, { src: coloredDataUrl })
        verbose("pregenerateTextures", `Generated pulse texture: ${cacheKey}`)
      }
    }
  }

  // Color shift textures
  if (shiftRate > 0) {
    const steps = 36
    for (let step = 0; step < steps; step++) {
      const hue = step * (360 / (steps - 1))
      const cacheKey = generateShiftTextureKey(x, y, step)
      if (!textureCache.has(cacheKey)) {
        const shiftedColor = hslToHex(hue, 100, 50)
        const coloredSvg = colorizeSVG(object.svg, shiftedColor, colorData)
        const coloredDataUrl = `data:image/svg+xml;base64,${btoa(coloredSvg)}`
        textureCache.set(cacheKey, { src: coloredDataUrl })
        verbose("pregenerateTextures", `Generated shift texture: ${cacheKey}`)
      }
    }
  }
}

export function updateAnimations(matrix, deltaTime, sprites) {
  if (!Array.isArray(matrix) || !Array.isArray(sprites)) {
    warn("animationEngine", "updateAnimations called with invalid parameters")
    return
  }

  const time = Date.now() * 0.001 // Time in seconds

  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      const object = matrix[y][x]
      if (!object) continue

      const sprite = sprites.find((s) => s.x === (x + 0.5) * 32 && s.y === (y + 0.5) * 32)
      if (!sprite) continue

      verbose("animationEngine", `Processing object at [${x},${y}]`)

      // Pulse Animation (scale/alpha)
      const pulseRate = _.get(object, "animation.pulseRate", 0)
      if (pulseRate > 0) {
        const syncType = _.get(object, "animation.syncType", "time")
        const amplitude = _.get(object, "animation.pulseAmplitude", 0)
        const baseScale = _.get(object, "transform.scale", 1)
        const flipX = ["h", "hv"].includes(object.transform?.flip) ? -1 : 1
        const flipY = ["v", "hv"].includes(object.transform?.flip) ? -1 : 1

        const beatTime = time * (syncType === "beat" ? 120 / 60 : pulseRate)
        const phase = Math.sin(beatTime * 2 * Math.PI)

        sprite.scale.x = baseScale * flipX * (1 + phase * amplitude)
        sprite.scale.y = baseScale * flipY * (1 + phase * amplitude)
        sprite.alpha = (_.get(object, "appearance.opacity", 1) * (1 + phase * amplitude))

        verbose("animationEngine", `Pulse at [${x},${y}], phase: ${phase}, scale: ${sprite.scale.x}, alpha: ${sprite.alpha}`)
      }

      // Color Pulse Animation
      const color = object.appearance?.color
      if (color?.pulseRate > 0 && color?.pulseColor !== "0") {
        const phase = (Math.sin(time * color.pulseRate * 2 * Math.PI) + 1) / 2
        const steps = 20
        const step = Math.round(phase * (steps - 1))
        const ratio = step / (steps - 1)
        const cacheKey = generatePulseTextureKey(x, y, color.base, color.pulseColor, step)

        const texture = textureCache.get(cacheKey)
        if (texture) {
          sprite.texture = texture
          verbose("animationEngine", `Color pulse at [${x},${y}], phase: ${phase}, color: ${blendColors(color.base, color.pulseColor, ratio)}`)
        } else {
          warn("animationEngine", `Missing pulse texture for key: ${cacheKey}`)
        }
      }

      // Color Shift Animation
      if (color?.shiftRate > 0) {
        const hue = (time * color.shiftRate * 360) % 360
        const steps = 36
        const step = Math.round(hue / (360 / (steps - 1)))
        const adjustedHue = step * (360 / (steps - 1))
        const cacheKey = generateShiftTextureKey(x, y, step)

        const texture = textureCache.get(cacheKey)
        if (texture) {
          sprite.texture = texture
          verbose("animationEngine", `Color shift at [${x},${y}], hue: ${adjustedHue}, color: ${hslToHex(adjustedHue, 100, 50)}`)
        } else {
          warn("animationEngine", `Missing shift texture for key: ${cacheKey}`)
        }
      }
    }
  }
}
