// particleTest.js - Test matrix for particle effects
import { debug, error } from "./logManager.js"

/**
 * Generate a test matrix specifically for testing particle effects
 * @returns {Array} 2D matrix with objects configured for particle testing
 */
export function generateParticleTestMatrix() {
  // Create a 10x10 matrix
  const matrix = Array(10)
    .fill()
    .map(() => Array(10).fill(null))

  // Fill with different block types in patterns

  // 1. Basic blocks with different colors for sparkle effects
  matrix[1][1] = createBlock(1, "sparkle", "#FF0000") // Red sparkle
  matrix[1][3] = createBlock(1, "sparkle", "#00FF00") // Green sparkle
  matrix[1][5] = createBlock(1, "sparkle", "#0000FF") // Blue sparkle
  matrix[1][7] = createBlock(1, "sparkle", "#FFFF00") // Yellow sparkle

  // 2. Special blocks with wave effects
  matrix[3][1] = createBlock(2, "wave", "#00FFFF") // Cyan wave
  matrix[3][3] = createBlock(2, "wave", "#FF00FF") // Magenta wave
  matrix[3][5] = createBlock(2, "wave", "#FFFFFF") // White wave
  matrix[3][7] = createBlock(2, "wave", "#FF8800") // Orange wave

  // 3. Obstacle blocks with shock effects
  matrix[5][1] = createBlock(3, "shock", "#FF0000") // Red shock
  matrix[5][3] = createBlock(3, "shock", "#FFFF00") // Yellow shock
  matrix[5][5] = createBlock(3, "shock", "#00FF00") // Green shock
  matrix[5][7] = createBlock(3, "shock", "#0000FF") // Blue shock

  // 4. Finish line with explosion effect
  matrix[7][7] = createBlock(4, "explosion", "#FFFFFF") // White explosion

  // 5. Create starting position for player
  matrix[8][1] = createBlock(5, null, "#888888") // Player start

  // Add floor (type 0) for the bottom row
  for (let x = 0; x < 10; x++) {
    matrix[9][x] = createBlock(0, null, "#888888") // Floor blocks
  }

  debug("particleTest", "Generated particle test matrix")
  return matrix
}

/**
 * Create a block with particle effect configuration
 * @param {number} type - Block type ID
 * @param {string} effectType - Type of particle effect (sparkle, wave, shock)
 * @param {string} color - Color in hex format
 * @returns {Object} Block object with appearance properties
 */
function createBlock(type, effectType, color) {
  const block = {
    type: type,
    appearance: {
      color: {
        base: color,
        tint: "0",
        tintIntensity: 0,
      },
    },
  }

  // Add effect specific properties
  if (effectType) {
    block.appearance.effects = {
      type: effectType,
      intensity: 1.0,
      rate: 0.5,
      color: color,
    }

    // Add pulse effect for specific types
    if (effectType === "sparkle" || effectType === "wave") {
      block.appearance.color.pulseColor = color
      block.appearance.color.pulseRate = 0.5
    }
  }

  return block
}

/**
 * Generate a SpriteMap object for the test matrix
 * @returns {Map} Map of block types to sprite configurations
 */
export function generateTestSpriteMap() {
  // Create a map for sprite definitions
  const spriteMap = new Map()

  // Basic types
  spriteMap.set("0", {
    assetId: "floor",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="0" y="0" width="32" height="32" fill="#888" data-fillable="true"/></svg>',
  })
  spriteMap.set("1", {
    assetId: "block",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="2" fill="#888" data-fillable="true"/></svg>',
  })
  spriteMap.set("2", {
    assetId: "special",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#888" data-fillable="true"/></svg>',
  })
  spriteMap.set("3", {
    assetId: "obstacle",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 30,16 16,30 2,16" fill="#888" data-fillable="true"/></svg>',
  })
  spriteMap.set("4", {
    assetId: "finish",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="0" y="0" width="32" height="32" fill="#888" data-fillable="true"/><text x="16" y="20" text-anchor="middle" font-family="sans-serif" font-size="12" fill="white">F</text></svg>',
  })
  spriteMap.set("5", {
    assetId: "player",
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#888" data-fillable="true"/></svg>',
  })

  return spriteMap
}

/**
 * Add a UI button to trigger particle effects on a specific block
 * @param {HTMLElement} container - Container to append the button to
 * @param {Object} renderEngine - The render engine instance
 */
export function addParticleTestControls(container, renderEngine) {
  if (!container || !renderEngine) return

  const controlPanel = document.createElement("div")
  controlPanel.id = "particleControls"
  controlPanel.style.cssText =
    "position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,0.7); padding: 10px; border-radius: 5px;"

  // Create buttons for different effects
  const effects = ["sparkle", "wave", "shock", "explosion"]

  effects.forEach((effect) => {
    const button = document.createElement("button")
    button.textContent = `Trigger ${effect}`
    button.style.cssText =
      'margin: 5px; padding: 8px; background: #00ff80; border: none; border-radius: 4px; color: #222; font-family: "Orbitron", sans-serif; cursor: pointer;'

    button.addEventListener("click", () => {
      triggerParticleEffect(renderEngine, effect)
    })

    controlPanel.appendChild(button)
  })

  container.appendChild(controlPanel)
  debug("particleTest", "Particle test controls added to UI")
}

/**
 * Trigger a particle effect on all blocks of the right type
 * @param {Object} renderEngine - The render engine instance
 * @param {string} effectType - The effect type to trigger
 */
function triggerParticleEffect(renderEngine, effectType) {
  if (!renderEngine || !renderEngine.blockSprites || !renderEngine.particleSystem) {
    error("particleTest", "Cannot trigger effect - missing render engine or particle system")
    return
  }

  debug("particleTest", `Triggering ${effectType} effect on all matching blocks`)

  let count = 0
  renderEngine.blockSprites.forEach((sprite) => {
    if (!sprite || !sprite.blockData) return

    // Match blocks with the right effect type
    const blockEffectType = sprite.blockData?.appearance?.effects?.type

    if (blockEffectType === effectType || (effectType === "explosion" && sprite.blockData.type === 4)) {
      // Get color information
      const color = sprite.blockData?.appearance?.color?.base || "#FFFFFF"

      // Create explosion effect
      if (effectType === "explosion") {
        renderEngine.particleSystem.createExplosion(sprite, color, 20)
      } else {
        // Emit 5 particles of the specified type
        for (let i = 0; i < 5; i++) {
          renderEngine.particleSystem.emit(sprite, effectType, 1.0 + Math.random())
        }
      }
      count++
    }
  })

  debug("particleTest", `Triggered ${effectType} effect on ${count} blocks`)
}
