// Modules/animationEngine.js
import { colorizeSVG } from "./spriteManager.js"
import { blendColors, hslToHex } from "./colorUtils.js"
import { warn, verbose, setLogLevel } from "./logManager.js"

setLogLevel("debug")
// Cache for pre-generated textures
const textureCache = new Map()

export function getTextureCache() {
  return textureCache
}

export function clearTextureCache() {
  textureCache.clear()
}

export function pregenerateTextures(object, x, y) {
  if (!object) return

  // Apply tint to the base color once before generating textures
  const colorData = {
    base: object.appearance.color.base,
    tint: object.appearance.color.tint,
    tintIntensity: object.appearance.color.tintIntensity,
    shiftRate: object.appearance.color.shiftRate,
    pulseColor: object.appearance.color.pulseColor,
    pulseRate: object.appearance.color.pulseRate,
  }

  // Color pulse textures
  if (object.appearance.color.pulseRate > 0 && object.appearance.color.pulseColor !== "0") {
    const steps = 20
    for (let step = 0; step < steps; step++) {
      const ratio = step / (steps - 1)
      const cacheKey = `pulse_${x}_${y}_${object.appearance.color.base}_${object.appearance.color.pulseColor}_${step}`
      verbose("pregenerateTextures", `Generated for color pulse: ${cacheKey}`)
      if (!textureCache.has(cacheKey)) {
        const blendedColor = blendColors(colorData.base, colorData.pulseColor, ratio)
        const coloredSvg = colorizeSVG(object.svg, blendedColor, colorData)
        const coloredDataUrl = `data:image/svg+xml;base64,${btoa(coloredSvg)}`
        textureCache.set(cacheKey, { src: coloredDataUrl })
      }
    }
  }

  // Color shift textures
  if (object.appearance.color.shiftRate > 0) {
    const steps = 36
    for (let step = 0; step < steps; step++) {
      const adjustedHue = step * (360 / (steps - 1))
      const cacheKey = `shift_${x}_${y}_${step}`
      verbose("pregenerateTextures", `Generated for color shift: ${cacheKey}`)
      if (!textureCache.has(cacheKey)) {
        const shiftedColor = hslToHex(adjustedHue, 100, 50)
        const coloredSvg = colorizeSVG(object.svg, shiftedColor, colorData)
        const coloredDataUrl = `data:image/svg+xml;base64,${btoa(coloredSvg)}`
        textureCache.set(cacheKey, { src: coloredDataUrl })
      }
    }
  }
}

export function updateAnimations(matrix, deltaTime, sprites) {
  if (!matrix || !sprites) {
    warn("animationEngine", "updateAnimations called with invalid parameters")
    return
  }

  verbose("animationEngine", "Starting animation update with deltaTime:", deltaTime)
  const time = Date.now() * 0.001 // Time in seconds

  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      const object = matrix[y][x]
      if (!object) continue

      const sprite = sprites.find((s) => s.x === (x + 0.5) * 32 && s.y === (y + 0.5) * 32) // blockSize = 32
      if (!sprite) continue

      verbose("animationEngine", `Processing object at [${x},${y}]`)

      // Handle pulsing (size and opacity)
      if (object.animation && object.animation.pulseRate) {
        let phase
        if (object.animation.syncType === "beat") {
          const bpm = 120
          const beatTime = time * (bpm / 60)
          phase = Math.sin(beatTime * 2 * Math.PI)
        } else {
          phase = Math.sin(time * object.animation.pulseRate * 2 * Math.PI)
        }

        const amplitude = object.animation.pulseAmplitude || 0
        const baseScale = object.transform?.scale || 1
        const flipX = object.transform?.flip === "h" || object.transform?.flip === "hv" ? -1 : 1
        const flipY = object.transform?.flip === "v" || object.transform?.flip === "hv" ? -1 : 1

        sprite.scale.x = baseScale * flipX * (1 + phase * amplitude)
        sprite.scale.y = baseScale * flipY * (1 + phase * amplitude)
        sprite.alpha = (object.appearance?.opacity || 1.0) * (1 + phase * amplitude)

        verbose(
          "animationEngine",
          `Animating sprite at [${x},${y}] with phase: ${phase}, scale: ${sprite.scale.x}, alpha: ${sprite.alpha}`,
        )
      }

      // Handle color pulse
      if (object.appearance?.color?.pulseRate > 0 && object.appearance?.color?.pulseColor !== "0") {
        const phase = (Math.sin(time * object.appearance.color.pulseRate * 2 * Math.PI) + 1) / 2
        const steps = 20
        const step = Math.round(phase * (steps - 1))
        const ratio = step / (steps - 1)
        const cacheKey = `pulse_${x}_${y}_${object.appearance.color.base}_${object.appearance.color.pulseColor}_${step}`

        const texture = textureCache.get(cacheKey)
        if (texture) {
          sprite.texture = texture
          verbose(
            "animationEngine",
            `Color pulsing sprite at [${x},${y}] with phase: ${phase}, color: ${blendColors(object.appearance.color.base, object.appearance.color.pulseColor, ratio)}`,
          )
        } else {
          warn("animationEngine", `Texture not found for ${cacheKey}`)
        }
      }

      // Handle color shift
      if (object.appearance?.color?.shiftRate > 0) {
        const hue = (time * object.appearance.color.shiftRate * 360) % 360
        const steps = 36
        const step = Math.round(hue / (360 / (steps - 1)))
        const adjustedHue = step * (360 / (steps - 1))
        const cacheKey = `shift_${x}_${y}_${step}`

        const texture = textureCache.get(cacheKey)
        if (texture) {
          sprite.texture = texture
          verbose(
            "animationEngine",
            `Color shifting sprite at [${x},${y}] with hue: ${adjustedHue}, color: ${hslToHex(adjustedHue, 100, 50)}`,
          )
        } else {
          warn("animationEngine", `Texture not found for ${cacheKey}`)
        }
      }
    }
  }
}
