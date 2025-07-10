// Modules/spriteManager.js
import { hexToHSL, hslToHex, blendColors } from "./colorUtils.js"
import { warn, error, debug, verbose } from "./logManager.js"

const COLOR_MAP = {
  0: "#000000",
  "-1": "#ff6b6b",
  "-2": "#4ecdc4",
  "-3": "#45b7d1",
  "-4": "#96ceb4",
  "-5": "#ff9f1c",
  "-6": "#ffbe0b",
  "-7": "#ff006e",
  "-8": "#8338ec",
  "-9": "#3a86ff",
}

function loadSVG(path, callback, retries = 3, retryDelay = 500) {
  function attemptLoad(attempt) {
    verbose("spriteManager", `Loading SVG from ${path} (attempt ${attempt}/${retries})`)
    const xhr = new XMLHttpRequest()
    xhr.open("GET", path, true)
    xhr.overrideMimeType("image/svg+xml")
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status === 0 || xhr.status === 200) {
          try {
            const svg = xhr.responseText
            if (!svg) throw new Error("Empty SVG response")
            verbose("spriteManager", `Successfully loaded SVG from ${path}`)
            callback(svg)
          } catch (e) {
            error("spriteManager", `Failed to process SVG for ${path} (attempt ${attempt}):`, e)
            if (attempt < retries) {
              debug("spriteManager", `Retrying load for ${path} (${attempt + 1}/${retries})`)
              setTimeout(() => attemptLoad(attempt + 1), retryDelay)
            } else {
              error("spriteManager", `Failed to load SVG for ${path} after ${retries} attempts`)
              callback(null)
            }
          }
        } else {
          error("spriteManager", `Failed to load SVG for ${path} (attempt ${attempt}): HTTP ${xhr.status}`)
          if (attempt < retries) {
            debug("spriteManager", `Retrying load for ${path} (${attempt + 1}/${retries})`)
            setTimeout(() => attemptLoad(attempt + 1), retryDelay)
          } else {
            error("spriteManager", `Failed to load SVG for ${path} after ${retries} attempts`)
            callback(null)
          }
        }
      }
    }
    xhr.onerror = () => {
      error("spriteManager", `Failed to load SVG for ${path} (attempt ${attempt}): Network error`)
      if (attempt < retries) {
        debug("spriteManager", `Retrying load for ${path} (${attempt + 1}/${retries})`)
        setTimeout(() => attemptLoad(attempt + 1), retryDelay)
      } else {
        error("spriteManager", `Failed to load SVG for ${path} after ${retries} attempts`)
        callback(null)
      }
    }
    xhr.send()
  }

  attemptLoad(1)
}

export async function loadSprites(directory) {
  debug("spriteManager", `Loading sprites from directory: ${directory}`)
  const spriteMap = new Map()
  const spriteIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
  const playerPath = `${directory}/player.svg`
  const floorPath = `${directory}/floor.svg`

  const assetsToLoad = []

  await Promise.all(
    spriteIds.map(
      (id) =>
        new Promise((resolve) => {
          const path = `${directory}/block_${id}.svg`
          loadSVG(path, (svg) => {
            if (svg) {
              const assetId = `block_${id}`
              const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`
              assetsToLoad.push({ alias: assetId, src: dataUrl })
              spriteMap.set(String(id), { assetId, svg })
            } else {
              warn("spriteManager", `Failed to load block_${id}.svg`)
            }
            resolve()
          })
        }),
    ),
  )

  // Load player sprite with fallback
  await new Promise((resolve) => {
    loadSVG(playerPath, (svg) => {
      const assetId = "player"
      if (svg) {
        const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`
        assetsToLoad.push({ alias: assetId, src: dataUrl })
        spriteMap.set("player", { assetId, svg })
      } else {
        // Create a fallback player sprite
        warn("spriteManager", "Failed to load player sprite, creating fallback")
        const fallbackSvg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
          '<rect width="100" height="100" fill="#ffffff"/>' +
          '<rect x="30" y="30" width="40" height="40" fill="#ff6b6b"/>' +
          "</svg>"
        const fallbackDataUrl = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`
        assetsToLoad.push({ alias: assetId, src: fallbackDataUrl })
        spriteMap.set("player", { assetId, svg: fallbackSvg })
        debug("spriteManager", "Created fallback player SVG")
      }
      resolve()
    })
  })

  // Floor loading with extra debug info
  await new Promise((resolve) => {
    debug("spriteManager", `Attempting to load floor sprite from: ${floorPath}`)
    loadSVG(floorPath, (svg) => {
      if (svg) {
        const assetId = "floor"
        try {
          const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`
          assetsToLoad.push({ alias: assetId, src: dataUrl })
          spriteMap.set("floor", { assetId, svg })
          debug("spriteManager", "Successfully processed floor.svg")
        } catch (e) {
          error("spriteManager", "Error processing floor.svg:", e)
          // Create a simple fallback SVG for floor
          const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
            <rect data-fillable="true" width="100" height="100" fill="#888888"/>
          </svg>`
          const fallbackDataUrl = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`
          assetsToLoad.push({ alias: assetId, src: fallbackDataUrl })
          spriteMap.set("floor", { assetId, svg: fallbackSvg })
        }
      } else {
        // Create a simple fallback SVG for floor
        warn("spriteManager", "Failed to load floor.svg, creating fallback")
        const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
          <rect data-fillable="true" width="100" height="100" fill="#888888"/>
        </svg>`
        const fallbackDataUrl = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`
        assetsToLoad.push({ alias: "floor", src: fallbackDataUrl })
        spriteMap.set("floor", { assetId: "floor", svg: fallbackSvg })
        debug("spriteManager", "Created fallback floor SVG")
      }
      resolve()
    })
  })

  // Final check for any missing required sprites
  const requiredSprites = ["floor", "player"]
  for (const type of requiredSprites) {
    if (!spriteMap.has(type)) {
      warn("spriteManager", `Missing required sprite after loading: ${type}, creating fallback`)
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="100" height="100" fill="${type === "player" ? "#ff6b6b" : "#888888"}"/>
      </svg>`
      const fallbackDataUrl = `data:image/svg+xml;base64,${btoa(fallbackSvg)}`
      assetsToLoad.push({ alias: type, src: fallbackDataUrl })
      spriteMap.set(type, { assetId: type, svg: fallbackSvg })
      debug("spriteManager", `Created final fallback for ${type}`)
    }
  }

  if (assetsToLoad.length > 0) {
    try {
      verbose(
        "spriteManager",
        "Loading assets into PixiJS Asset cache:",
        assetsToLoad.map((asset) => asset.alias),
      )
      await window.PIXI.Assets.load(assetsToLoad)
      verbose(
        "spriteManager",
        "All sprites preloaded into PixiJS Assets cache:",
        assetsToLoad.map((asset) => asset.alias),
      )
    } catch (err) {
      error("spriteManager", "Failed to preload assets into PixiJS Assets cache:", err)
    }
  }

  debug("spriteManager", "Loaded sprites:", Array.from(spriteMap.keys()))
  return spriteMap
}

export async function getFloorSprite(spriteMap) {
  debug("spriteManager", "Getting floor sprite...")
  const spriteData = spriteMap.get("floor")
  if (!spriteData) {
    warn("spriteManager", "No floor sprite data found in spriteMap")
    return null
  }

  const { assetId, svg } = spriteData
  let texture

  try {
    // Use existing cached texture if possible
    if (window.PIXI.Assets.cache.has(assetId)) {
      texture = window.PIXI.Assets.get(assetId)
      verbose("spriteManager", "Using cached floor texture")
    } else {
      debug("spriteManager", "Floor texture not found in cache, creating new texture")
      const dataUrl = `data:image/svg+xml;base64,${btoa(svg)}`
      await window.PIXI.Assets.load({ alias: assetId, src: dataUrl })
      texture = window.PIXI.Assets.get(assetId)
    }

    if (!texture) {
      error("spriteManager", `Floor asset ${assetId} not found in PixiJS Assets cache`)
      return null
    }
  } catch (err) {
    error("spriteManager", "Failed to load floor texture:", err)
    return null
  }

  const sprite = new window.PIXI.Sprite(texture)
  debug("spriteManager", "Successfully created floor sprite")
  // Store the asset ID on the sprite for cleanup
  sprite.assetId = assetId

  sprite.destroy = function (options) {
    try {
      // Only unload if explicitly asked to
      if (options && options.removeTextures) {
        // Use unload instead of remove as per PixiJS warning
        if (window.PIXI.Assets.unload) {
          window.PIXI.Assets.unload(this.assetId || assetId)
        } else {
          // Fallback for older versions
          window.PIXI.utils.TextureCache[this.assetId || assetId] = null
          delete window.PIXI.utils.TextureCache[this.assetId || assetId]
        }
      }

      // Only destroy the texture on full cleanups
      if (options && (options.removeTextures || options.children)) {
        texture.destroy(true)
      }
    } catch (err) {
      error("spriteManager", "Error cleaning up floor sprite:", err)
    }
  }
  return sprite
}

export async function getSprite(type, spriteMap, colorData = {}) {
  const spriteData = spriteMap.get(String(type))
  if (!spriteData) return null

  const { assetId, svg } = spriteData
  let texture

  try {
    // Skip colorization if skipColorize is true or colorData is not provided
    const coloredSvg = colorData.skipColorize ? svg : colorizeSVG(svg, colorData.base || "#888", colorData)
    const coloredDataUrl = `data:image/svg+xml;base64,${btoa(coloredSvg)}`

    const coloredAssetId = `${assetId}_colored_${colorData.base}_${colorData.tint}_${colorData.tintIntensity}`
    if (!window.PIXI.Assets.cache.has(coloredAssetId)) {
      await window.PIXI.Assets.load({ alias: coloredAssetId, src: coloredDataUrl })
    }

    texture = window.PIXI.Assets.get(coloredAssetId)
    if (!texture) {
      error("spriteManager", `Colored asset ${coloredAssetId} not found in PixiJS Assets cache`)
      return null
    }

    // Store the asset ID on the texture for cleanup later
    texture.assetId = coloredAssetId
  } catch (err) {
    error("spriteManager", `Failed to load texture for type ${type}:`, err)
    return null
  }

  const sprite = new window.PIXI.Sprite(texture)
  sprite.anchor.set(0.5)

  // Store the asset ID on the sprite for cleanup
  sprite.assetId = texture.assetId

  // Override destroy method to properly clean up textures from cache
  const originalDestroy = sprite.destroy
  sprite.destroy = function (options) {
    try {
      // Only do extensive cleanup if options.removeTextures is true
      // This allows for reusing assets between levels
      if (options && options.removeTextures) {
        // Cleanup cached textures
        try {
          const assetId = this.assetId || texture.assetId
          if (
            assetId &&
            window.PIXI.Assets.cache &&
            window.PIXI.Assets.cache.has &&
            window.PIXI.Assets.cache.has(assetId)
          ) {
            debug("spriteManager", `Unloading asset from cache: ${assetId}`)

            // Use unload instead of remove as per PixiJS warning
            if (window.PIXI.Assets.unload) {
              window.PIXI.Assets.unload(assetId)
            } else {
              // Fallback for older versions
              window.PIXI.utils.TextureCache[assetId] = null
              delete window.PIXI.utils.TextureCache[assetId]
            }
          }
        } catch (err) {
          error("spriteManager", `Error unloading asset:`, err)
        }
      }
      // Only destroy texture if removing textures or forced
      if (texture && options && (options.removeTextures || options.children)) {
        texture.destroy(true)
      }
    } catch (err) {
      error("spriteManager", "Error during sprite cleanup:", err)
    }

    // Call original destroy method
    return originalDestroy.call(this, options)
  }

  return sprite
}

export async function getPlayerSprite(spriteMap, color = "#ffffff") {
  const spriteData = spriteMap.get("player")
  if (!spriteData) return null

  const { assetId, svg } = spriteData
  let texture

  try {
    const coloredSvg = colorizeSVG(svg, color, { base: color, tint: "0", tintIntensity: 0 })
    const coloredDataUrl = `data:image/svg+xml;base64,${btoa(coloredSvg)}`

    const coloredAssetId = `player_colored_${color}`
    if (!window.PIXI.Assets.cache.has(coloredAssetId)) {
      await window.PIXI.Assets.load({ alias: coloredAssetId, src: coloredDataUrl })
    }

    texture = window.PIXI.Assets.get(coloredAssetId)
    if (!texture) {
      error("spriteManager", `Colored asset ${coloredAssetId} not found in PixiJS Assets cache`)
      return null
    }
  } catch (err) {
    error("spriteManager", "Failed to load player texture:", err)
    return null
  }

  const sprite = new window.PIXI.Sprite(texture)
  sprite.anchor.set(0.5)

  // Override destroy method to properly clean up textures from cache
  const originalDestroy = sprite.destroy
  // Store the player asset ID on the sprite for cleanup
  sprite.assetId = `player_colored_${color}`

  // Improved destroy method
  sprite.destroy = function (options) {
    try {
      // Only do extensive cleanup if options.removeTextures is true
      // This allows for reusing assets between levels
      if (options && options.removeTextures) {
        try {
          const assetId = this.assetId
          if (
            assetId &&
            window.PIXI.Assets.cache &&
            window.PIXI.Assets.cache.has &&
            window.PIXI.Assets.cache.has(assetId)
          ) {
            debug("spriteManager", `Unloading player asset from cache: ${assetId}`)

            // Use unload instead of remove as per PixiJS warning
            if (window.PIXI.Assets.unload) {
              window.PIXI.Assets.unload(assetId)
            } else {
              // Fallback for older versions
              window.PIXI.utils.TextureCache[assetId] = null
              delete window.PIXI.utils.TextureCache[assetId]
            }
          }
        } catch (err) {
          error("spriteManager", `Error unloading player asset:`, err)
        }
      }

      // Only destroy texture if removing textures or forced
      if (texture && options && (options.removeTextures || options.children)) {
        texture.destroy(true)
      }
    } catch (err) {
      error("spriteManager", "Error during player sprite cleanup:", err)
    }

    // Call original destroy method
    return originalDestroy.call(this, options)
  }

  return sprite
}

export function colorizeSVG(svgString, color, colorData) {
  let colored = svgString
  try {
    // Check if svgString is valid
    if (!svgString || typeof svgString !== "string" || svgString.trim() === "") {
      throw new Error("Invalid SVG: empty or not a string")
    }

    if (!colorData || !colorData.base) {
      throw new Error("Invalid colorData: base color missing")
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(svgString, "image/svg+xml")

    // Check for parsing errors - DOMParser doesn't throw on invalid XML
    // Instead it creates a document with a parsererror element
    const parseError = doc.querySelector("parsererror")
    if (parseError) {
      throw new Error(`Invalid SVG: XML parsing error - ${parseError.textContent}`)
    }

    const fillables = doc.querySelectorAll('[data-fillable="true"]')

    let mainColor = color === "#888" ? colorData.base || "#888" : color
    if (/^-?\d+$/.test(mainColor)) mainColor = COLOR_MAP[mainColor] || mainColor
    if (mainColor.startsWith('"') && mainColor.endsWith('"')) mainColor = mainColor.slice(1, -1)

    const tintColor = colorData.tint || "0"
    const tintIntensity = Number.parseFloat(colorData.tintIntensity) || 0

    let finalColor = mainColor
    if (tintColor !== "0" && tintIntensity > 0) {
      finalColor = blendColors(mainColor, tintColor, tintIntensity)
    }

    const [h, s, l] = hexToHSL(finalColor)
    const borderColor = hslToHex(h, s, Math.max(l - 30, 0))
    const innerColor = hslToHex(h, s * 0.5, Math.min(l + 30, 100))

    fillables.forEach((el) => {
      if (el.tagName === "stop" && el.hasAttribute("stop-color")) {
        el.setAttribute("stop-color", finalColor)
      } else if (
        (el.tagName === "circle" || el.tagName === "ellipse") &&
        el.getAttribute("fill") === "none" &&
        el.hasAttribute("stroke")
      ) {
        el.setAttribute("stroke", borderColor)
      } else if (
        (el.tagName === "circle" || el.tagName === "ellipse") &&
        el.getAttribute("fill") &&
        !el.getAttribute("fill").startsWith("url(")
      ) {
        el.setAttribute("fill", innerColor)
      } else if (el.hasAttribute("fill") && !el.getAttribute("fill").startsWith("url(")) {
        el.setAttribute("fill", finalColor)
      }
    })

    colored = new XMLSerializer().serializeToString(doc.documentElement)
  } catch (e) {
    warn("spriteManager", "colorizeSVG failed:", e)
  }
  return colored
}
