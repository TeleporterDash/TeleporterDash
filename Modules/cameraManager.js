// Modules/cameraManager.js
import { warn, debug, verbose, setLogLevel } from "./logManager.js"

setLogLevel("debug")
/**
 * CameraManager
 * Handles camera movement and tracking for the game
 */
export default class CameraManager {
  constructor(container, levelWidth, levelHeight, viewportWidth, viewportHeight) {
    this.container = container
    this.levelWidth = levelWidth
    this.levelHeight = levelHeight
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight

    this.x = 0
    this.y = 0
    this.targetX = 0
    this.targetY = 0

    // Camera smoothing factor (0 = no smoothing, 1 = maximum smoothing)
    this.smoothing = 0.1

    // Dead zone threshold (fraction of viewport dimensions)
    this.deadZoneThreshold = 0.05 // e.g., 5% of width/height

    // Bounds to keep camera within level
    this.bounds = {
      left: 0,
      right: levelWidth - viewportWidth,
      top: 0,
      bottom: levelHeight - viewportHeight,
    }

    // Flag to control whether floor is always visible
    this.keepFloorVisible = true
    // Offset from bottom of viewport to ensure floor visibility
    this.floorOffset = 32 // 1 block height

    // Initialize tween properties
    this.zoomTween = null
    this.shakeTween = null
    this.tiltTween = null
    this.panTween = null
    this._originalShakePosition = null
  }

  /**
   * Set camera bounds
   * @param {number} left - Left bound
   * @param {number} right - Right bound
   * @param {number} top - Top bound
   * @param {number} bottom - Bottom bound
   */
  setBounds(left, right, top, bottom) {
    this.bounds = { left, right, top, bottom }
  }

  /**
   * Update camera dimensions
   * @param {number} levelWidth - Level width
   * @param {number} levelHeight - Level height
   * @param {number} viewportWidth - Viewport width
   * @param {number} viewportHeight - Viewport height
   */
  updateDimensions(levelWidth, levelHeight, viewportWidth, viewportHeight) {
    this.levelWidth = levelWidth
    this.levelHeight = levelHeight
    this.viewportWidth = viewportWidth
    this.viewportHeight = viewportHeight

    // Update bounds
    this.bounds = {
      left: 0,
      right: levelWidth - viewportWidth,
      top: 0,
      bottom: levelHeight - viewportHeight,
    }
  }

  /**
   * Follow target
   * @param {Object} target - Target to follow (e.g., player)
   * @param {number} offsetX - X offset from center
   * @param {number} offsetY - Y offset from center
   */
  follow(target, offsetX = 0, offsetY = 0) {
    if (!target || typeof target.x !== "number" || typeof target.y !== "number") {
      warn("cameraManager", "Invalid target for camera follow:", target)
      return
    }

    verbose("cameraManager", `Following target at [${target.x}, ${target.y}]`)

    // For horizontal tracking, keep the player slightly to the left of center
    // This shows more of the level ahead of the player
    const horizOffset = -this.viewportWidth * 0.2 // Show more of the level ahead

    // Calculate target position (centered on target with offset)
    this.targetX = target.x - this.viewportWidth / 2 + horizOffset + offsetX
    this.targetY = target.y - this.viewportHeight / 2 + offsetY

    // Ensure floor is visible if enabled
    if (this.keepFloorVisible) {
      const floorY = this.levelHeight - this.floorOffset
      const minCameraY = floorY - this.viewportHeight
      this.targetY = Math.max(this.targetY, minCameraY)
    }
  }

  /**
   * Update camera position with smoothing
   * @param {number} [deltaTime] - Time since last update in milliseconds (unused, kept for API compatibility)
   */
  update(deltaTime) {
    // Calculate dead zone in pixels
    const deadZoneX = this.viewportWidth * this.deadZoneThreshold
    const deadZoneY = this.viewportHeight * this.deadZoneThreshold

    // Calculate difference between current and target positions
    const dx = this.targetX - this.x
    const dy = this.targetY - this.y

    let nextX = this.x
    let nextY = this.y

    // Apply smoothing only if target is outside the dead zone
    if (Math.abs(dx) > deadZoneX) {
      nextX += dx * this.smoothing
    } else {
      // If inside deadzone horizontally, don't smooth towards targetX
      // Optionally, you could slightly move back towards the ideal resting point if needed
    }

    if (Math.abs(dy) > deadZoneY) {
      nextY += dy * this.smoothing
    } else {
      // If inside deadzone vertically, don't smooth towards targetY
    }

    // Debug log before clamping
    verbose(
      "cameraManager",
      `Update Pre-Clamp: X=${nextX.toFixed(2)}, Y=${nextY.toFixed(2)}, TargetX=${this.targetX.toFixed(2)}, TargetY=${this.targetY.toFixed(2)}, BoundsRight=${this.bounds.right.toFixed(2)}, BoundsBottom=${this.bounds.bottom.toFixed(2)}`,
    )

    // Clamp position within bounds
    this.x = Math.max(this.bounds.left, Math.min(nextX, this.bounds.right))
    this.y = Math.max(this.bounds.top, Math.min(nextY, this.bounds.bottom))

    // Debug log after clamping
    verbose("cameraManager", `Update Post-Clamp: X=${this.x.toFixed(2)}, Y=${this.y.toFixed(2)}`)

    // Apply position to container
    this.container.x = -this.x
    this.container.y = -this.y
  }

  /**
   * Force camera to specific position
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  setPosition(x, y) {
    this.targetX = x
    this.targetY = y
    this.x = x
    this.y = y

    // Clamp position within bounds
    this.x = Math.max(this.bounds.left, Math.min(this.x, this.bounds.right))
    this.y = Math.max(this.bounds.top, Math.min(this.y, this.bounds.bottom))

    // Apply position to container
    this.container.x = -this.x
    this.container.y = -this.y
  }

  /**
   * Set whether floor should always be visible
   * @param {boolean} keepVisible - Should floor be kept visible
   * @param {number} offset - Offset from bottom of viewport to ensure floor visibility
   */
  setFloorVisibility(keepVisible, offset = 32) {
    this.keepFloorVisible = keepVisible
    this.floorOffset = offset
  }

  /**
   * Reset the camera to follow the player's initial position
   * @param {Object} player - The player object with initialX and initialY properties
   */
  reset(player) {
    debug("CameraManager", "Resetting camera position...")

    // First, reset any active effects
    this.resetEffects()

    // Reset position based on the provided player's initial position
    this.targetX = player.initialX - this.viewportWidth / 2 // Center viewport H
    this.targetY = player.initialY - this.viewportHeight / 2 // Center viewport V

    this.x = this.targetX
    this.y = this.targetY

    // Clamp position within bounds
    this.x = Math.max(this.bounds.left, Math.min(this.x, this.bounds.right))
    this.y = Math.max(this.bounds.top, Math.min(this.y, this.bounds.bottom))

    // Reset target to match actual position after clamping
    this.targetX = this.x
    this.targetY = this.y

    // Apply the clamped camera position to the container
    if (this.container) {
      this.container.x = -this.x
      this.container.y = -this.y

      // Reset any container transforms
      this.container.scale.set(1)
      this.container.rotation = 0
      this.container.skew.set(0)
      this.container.pivot.set(0)

      // Ensure no filters are left applied
      this.container.filters = null
    }

    debug(
      "CameraManager",
      `Camera reset to target: (${this.targetX.toFixed(2)}, ${this.targetY.toFixed(2)}), Final Position: (${this.x.toFixed(2)}, ${this.y.toFixed(2)})`,
    )
  }

  /**
   * Zoom the camera to a specific level
   * @param {number} level - Zoom level (1.0 = normal, 2.0 = 2x zoom, etc.)
   * @param {number} duration - Duration of zoom animation in seconds
   */
  zoomTo(level, duration = 0.5) {
    if (this.zoomTween) this.zoomTween.kill()

    const startZoom = this.container.scale.x
    const endZoom = Math.max(0.1, Math.min(level, 5.0)) // Clamp zoom level

    if (duration <= 0) {
      this.container.scale.set(endZoom)
      return
    }

    this.zoomTween = gsap.to(this.container.scale, {
      x: endZoom,
      y: endZoom,
      duration: duration,
      ease: "power2.inOut",
      onUpdate: () => {
        // Keep camera centered while zooming
        this.container.pivot.set(this.viewportWidth / 2, this.viewportHeight / 2)
        this.container.position.set(this.viewportWidth / 2, this.viewportHeight / 2)
      },
    })
  }

  /**
   * Shake the camera
   * @param {number} intensity - Shake intensity
   * @param {number} duration - Duration of shake in seconds
   */
  shake(intensity = 5, duration = 0.5) {
    if (this.shakeTween) this.shakeTween.kill()

    const originalX = this.container.x
    const originalY = this.container.y

    // Store the original position
    this._originalShakePosition = { x: originalX, y: originalY }

    // Create a shake animation
    this.shakeTween = gsap.to(
      {},
      {
        duration: duration,
        onUpdate: () => {
          // Apply random offset based on intensity
          const offsetX = (Math.random() - 0.5) * intensity * 2
          const offsetY = (Math.random() - 0.5) * intensity * 2

          this.container.x = originalX + offsetX
          this.container.y = originalY + offsetY
        },
        onComplete: () => {
          // Reset to original position
          this.container.x = originalX
          this.container.y = originalY
          this._originalShakePosition = null
        },
      },
    )
  }

  /**
   * Tilt the camera
   * @param {number} angle - Tilt angle in degrees
   * @param {string} direction - Tilt direction ('left' or 'right')
   * @param {number} duration - Duration of tilt animation in seconds
   */
  tilt(angle = 15, direction = "left", duration = 0.5) {
    if (this.tiltTween) this.tiltTween.kill()

    const tiltAngle = direction === "left" ? -angle : angle

    this.tiltTween = gsap.to(this.container, {
      rotation: tiltAngle * (Math.PI / 180), // Convert to radians
      duration: duration,
      ease: "back.out(1.7)",
    })
  }

  /**
   * Pan the camera by an offset
   * @param {number} offsetX - X offset in pixels
   * @param {number} offsetY - Y offset in pixels
   * @param {number} duration - Duration of pan animation in seconds
   */
  pan(offsetX = 100, offsetY = 0, duration = 1.0) {
    if (this.panTween) this.panTween.kill()

    const startX = this.x
    const startY = this.y

    this.panTween = gsap.to(this, {
      targetX: startX + offsetX,
      targetY: startY + offsetY,
      duration: duration,
      ease: "sine.inOut",
      onUpdate: () => {
        // Update camera position
        this.update()
      },
      onComplete: () => {
        // Optionally return to original position
        if (duration > 0) {
          gsap.to(this, {
            targetX: startX,
            targetY: startY,
            duration: duration,
            ease: "sine.inOut",
            onUpdate: () => this.update(),
          })
        }
      },
    })
  }

  /**
   * Reset all camera effects
   */
  resetEffects() {
    if (this.zoomTween) this.zoomTween.kill()
    if (this.shakeTween) this.shakeTween.kill()
    if (this.tiltTween) this.tiltTween.kill()
    if (this.panTween) this.panTween.kill()

    // Reset all transforms
    this.container.scale.set(1)
    this.container.rotation = 0

    // Reset position to current target
    this.x = this.targetX
    this.y = this.targetY
    this.container.x = -this.x
    this.container.y = -this.y
  }
}
