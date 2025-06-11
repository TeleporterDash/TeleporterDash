// Modules/visualEngine.js
// Displacement map for distortion (simple noise texture)
let displacementSprite = null
function createDisplacementSprite() {
  if (displacementSprite) return displacementSprite
  const canvas = document.createElement("canvas")
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext("2d")
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const value = Math.random() * 255
      ctx.fillStyle = `rgb(${value},${value},${value})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  displacementSprite = window.PIXI.Sprite.from(canvas)
  displacementSprite.texture.source.addressMode = "repeat" // Updated for PixiJS v8.9.1
  return displacementSprite
}

export function applyVisualEffects(sprite, appearance) {
  if (!appearance) return

  const filters = []

  // Handle tint (but don’t override opacity)
  const { color } = appearance
  if (color) {
    const { tint, tintIntensity } = color

    // Apply tint without affecting opacity
    if (tint && tint !== "0" && tintIntensity > 0) {
      const tintColor = Number.parseInt(tint.replace("#", ""), 16)
      sprite.tint = tintColor
    }
  }

  // Apply glow effect using glowColor and glowIntensity
  if (appearance?.glowIntensity && Number.parseFloat(appearance.glowIntensity) > 0) {
    try {
      const glowColor = appearance.glowColor || "#FFFFFF"
      const glowIntensity = Number.parseFloat(appearance.glowIntensity)
      const colorNum = Number.parseInt(glowColor.replace("#", ""), 16)
      const glowFilter = new window.PIXI.filters.GlowFilter({
        distance: 10,
        outerStrength: glowIntensity * 2,
        innerStrength: 0,
        color: colorNum,
        quality: 0.1,
      })
      filters.push(glowFilter)
      console.log("Applying GlowFilter with intensity:", glowIntensity, "color:", glowColor)
    } catch (error) {
      console.error("Failed to apply GlowFilter:", error)
    }
  }

  // Apply shadow effect
  if (appearance?.shadowSize && Number.parseFloat(appearance.shadowSize) > 0) {
    try {
      const shadowColor = appearance.shadowColor || "#000000"
      const shadowSize = Number.parseFloat(appearance.shadowSize)
      const colorNum = Number.parseInt(shadowColor.replace("#", ""), 16)
      const shadowFilter = new window.PIXI.filters.DropShadowFilter({
        distance: shadowSize,
        angle: Math.PI / 4,
        alpha: 0.5,
        color: colorNum,
      })
      filters.push(shadowFilter)
      console.log("Applying DropShadowFilter with size:", shadowSize, "color:", shadowColor)
    } catch (error) {
      console.error("Failed to apply DropShadowFilter:", error)
    }
  }

  // Blend Mode
  const blendMode = appearance?.blendMode || "normal"
  switch (blendMode) {
    case "add":
      sprite.blendMode = window.PIXI.ADD
      break
    case "multiply":
      sprite.blendMode = window.PIXI.MULTIPLY
      break
    case "screen":
      sprite.blendMode = window.PIXI.SCREEN
      break
    default:
      sprite.blendMode = window.PIXI.NORMAL
  }

  // Distortion
  const distortionType = appearance?.distortionType || "0"
  const distortionIntensity = Number.parseFloat(appearance?.distortionIntensity) || 0
  if (distortionType !== "0" && distortionIntensity > 0) {
    const displacementFilter = new window.PIXI.DisplacementFilter(createDisplacementSprite())
    displacementFilter.scale.x = distortionIntensity * 20
    displacementFilter.scale.y = distortionIntensity * 20
    filters.push(displacementFilter)
    sprite.distortionFilter = displacementFilter // Store for animation
  }

  sprite.filters = filters.length > 0 ? filters : null
}

// Track time globally to maintain continuous animation
let accumulatedTime = 0

export function updateVisualEffects(sprites, deltaTime) {
  // Add the normalized deltaTime to our accumulated time
  // deltaTime is typically in milliseconds, we convert to seconds for consistency
  accumulatedTime += deltaTime * 0.001

  sprites.forEach((sprite) => {
    // Animate distortion using accumulated time instead of Date.now()
    if (sprite.distortionFilter) {
      sprite.distortionFilter.offset = {
        x: Math.sin(accumulatedTime * 2) * 10,
        y: Math.cos(accumulatedTime * 2) * 10,
      }
    }
  })
}
