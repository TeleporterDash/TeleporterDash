// Modules/popupManager.js
import { warn, debug, setLogLevel } from "./logManager.js"
import { applyVisualEffects } from "./visualEngine.js"

setLogLevel("debug")

export class PopupManager {
  constructor({ achievementIconPath = "../Sprites/Achievements" } = {}) {
    this.popups = new Map()
    this.achievementPopups = new Map()
    this.achievementIconPath = achievementIconPath
    this.currentErrorPopup = null

    // Track event listeners
    this.eventListeners = new Map()
  }

  /**
   * Add an event listener to an element with tracking
   * @param {HTMLElement} element - The element to add listener to
   * @param {string} eventType - The type of event (e.g., 'click', 'mouseover')
   * @param {Function} callback - The event handler function
   */
  addTrackedEventListener(element, eventType, callback) {
    if (!element) {
      warn("popupManager", `Cannot add ${eventType} listener to null element`)
      return
    }

    // Store the listener for potential removal
    if (!this.eventListeners.has(element)) {
      this.eventListeners.set(element, new Map())
    }

    const elementListeners = this.eventListeners.get(element)
    elementListeners.set(eventType, callback)

    element.addEventListener(eventType, callback)
  }

  /**
   * Remove a specific event listener from an element
   * @param {HTMLElement} element - The element to remove listener from
   * @param {string} eventType - The type of event to remove
   */
  removeTrackedEventListener(element, eventType) {
    if (!element) return

    const elementListeners = this.eventListeners.get(element)
    if (elementListeners && elementListeners.has(eventType)) {
      const callback = elementListeners.get(eventType)
      element.removeEventListener(eventType, callback)
      elementListeners.delete(eventType)
    }
  }

  /**
   * Remove all event listeners for a specific element
   * @param {HTMLElement} element - The element to remove all listeners from
   */
  clearElementEventListeners(element) {
    if (!element) return

    const elementListeners = this.eventListeners.get(element)
    if (elementListeners) {
      for (const [eventType, callback] of elementListeners) {
        element.removeEventListener(eventType, callback)
      }
      this.eventListeners.delete(element)
    }
  }

  createPopup(id, content, isAchievement = false) {
    const popup = document.createElement("div")
    popup.className = `popup ${isAchievement ? "achievement-popup" : ""}`
    popup.id = `popup-${id}`
    popup.innerHTML = `
      <div class="popup-content">
        ${content}
      </div>
    `
    document.body.appendChild(popup)
    if (isAchievement) {
      this.achievementPopups.set(id, popup)
    } else {
      this.popups.set(id, popup)
    }
    return popup
  }

  showPopup(id, isAchievement = false) {
    const popup = isAchievement ? this.achievementPopups.get(id) : this.popups.get(id)

    if (!popup) {
      warn("popupManager", `No popup found with ID ${id}`)
      return
    }

    popup.classList.add("active")
    popup.style.opacity = "1"
    popup.style.transition = "opacity 0.3s ease-in-out"

    if (isAchievement) {
      applyVisualEffects(popup.querySelector(".popup-content"), { type: "achievement" })
    }
  }

  hidePopup(id, isAchievement = false) {
    const popup = isAchievement ? this.achievementPopups.get(id) : this.popups.get(id)

    if (!popup) {
      warn("popupManager", `No popup found with ID ${id}`)
      return
    }

    popup.classList.remove("active")
    popup.style.opacity = "0"
    setTimeout(() => {
      popup.remove()
      if (isAchievement) {
        this.achievementPopups.delete(id)
      } else {
        this.popups.delete(id)
      }
    }, 300)
  }

  createAchievementPopup(achievement) {
    const content = `
      <h2 id="popup-${achievement.id}-title" class="visually-hidden">Achievement Unlocked!</h2>
      <button class="popup-close" title="Close">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="white"/>
        </svg>
      </button>
      <div class="popup-body">
        <div class="achievement-icon">
          <img src="${this.achievementIconPath}/${achievement.icon}.svg" alt="${achievement.name}">
        </div>
        <h3>${achievement.name}</h3>
        <p>${achievement.description}</p>
        <span class="achievement-points">+${achievement.points} points</span>
      </div>
    `

    const popup = this.createPopup(achievement.id, content, true)
    popup.setAttribute("role", "dialog")
    popup.setAttribute("aria-labelledby", `popup-${achievement.id}-title`)

    const closeButton = popup.querySelector(".popup-close")

    // Use tracked event listener
    this.addTrackedEventListener(closeButton, "click", () => this.hidePopup(achievement.id, true))

    this.showPopup(achievement.id, true)
  }

  createRegularPopup(id, content) {
    return this.createPopup(id, content, false)
  }

  /**
   * Show an error popup with detailed information
   * @param {Object} errorConfig - Configuration for the error popup
   * @param {string} errorConfig.title - Title of the error popup
   * @param {string} errorConfig.message - Main error message
   * @param {string} [errorConfig.details] - Optional detailed error information
   */
  showErrorPopup(errorConfig) {
    // Prevent multiple error popups
    if (this.currentErrorPopup) {
      this.hideErrorPopup(this.currentErrorPopup)
    }

    // Check if DOM is ready
    if (!document.body) {
      warn("popupManager", "Cannot create popup: document.body is not available. DOM may not be fully loaded.")
      return null
    }

    // Create popup container
    const errorPopup = document.createElement("div")
    errorPopup.className = "popup error-popup"
    errorPopup.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: #ff4d4d;
      color: white;
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      z-index: 1000;
      max-width: 80%;
      width: 300px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    `

    // Title
    const titleElement = document.createElement("h2")
    titleElement.textContent = errorConfig.title || "Error"
    titleElement.style.cssText = `
      margin-bottom: 15px;
      font-size: 1.2em;
    `
    errorPopup.appendChild(titleElement)

    // Message
    const messageElement = document.createElement("p")
    messageElement.textContent = errorConfig.message || "An unexpected error occurred."
    messageElement.style.cssText = `
      margin-bottom: 15px;
      font-size: 1em;
    `
    errorPopup.appendChild(messageElement)

    // Details (optional)
    if (errorConfig.details) {
      const detailsElement = document.createElement("pre")
      detailsElement.textContent = errorConfig.details
      detailsElement.style.cssText = `
        background-color: rgba(0,0,0,0.1);
        padding: 10px;
        border-radius: 5px;
        max-height: 100px;
        overflow-y: auto;
        font-size: 0.8em;
        margin-bottom: 15px;
      `
      errorPopup.appendChild(detailsElement)
    }

    // Close button
    const closeButton = document.createElement("button")
    closeButton.textContent = "Close"
    closeButton.style.cssText = `
      background-color: white;
      color: #ff4d4d;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      transition: background-color 0.3s;
    `
    closeButton.addEventListener("click", () => this.hideErrorPopup(errorPopup))
    errorPopup.appendChild(closeButton)

    // Add to document
    document.body.appendChild(errorPopup)

    // Track current error popup
    this.currentErrorPopup = errorPopup

    // Automatically close after 10 seconds if not manually closed
    const autoCloseTimer = setTimeout(() => {
      this.hideErrorPopup(errorPopup)
    }, 10000)

    return errorPopup
  }

  /**
   * Hide the error popup
   * @param {HTMLElement} [popup] - Specific popup to hide, defaults to current error popup
   */
  hideErrorPopup(popup) {
    const popupToHide = popup || this.currentErrorPopup
    if (popupToHide) {
      document.body.removeChild(popupToHide)
      this.currentErrorPopup = null
    }
  }

  /**
   * Clean up all popup-related resources
   */
  cleanup() {
    // Remove all tracked event listeners
    for (const element of this.eventListeners.keys()) {
      this.clearElementEventListeners(element)
    }

    // Clear all popups
    this.popups.forEach((popup) => popup.remove())
    this.achievementPopups.forEach((popup) => popup.remove())

    this.popups.clear()
    this.achievementPopups.clear()

    debug("popupManager", "Popup manager cleaned up")
  }
}

// Add CSS for both types of popups
const style = document.createElement("style")
style.textContent = `
  .popup {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 20px;
    border-radius: 8px;
    z-index: 1000;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
  }

  .achievement-popup {
    position: fixed;
    top: 20px;
    right: 0; /* Already set to 0 */
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 15px;
    border-radius: 8px;
    z-index: 1000;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    max-width: 300px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transform: translateX(0); /* Removed translate(0, 0) to avoid interference */
  }

  .popup-close {
    position: absolute;
    top: 10px;
    left: 10px;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: #FFD700;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s;
  }

  .popup-close:hover {
    color: #FFA500;
  }

  .popup-close svg {
    width: 100%;
    height: 100%;
  }

  .popup.active {
    opacity: 1;
  }

  .popup-header {
    font-size: 1.2em;
    margin-bottom: 10px;
    color: #FFD700;
  }

  .achievement-icon {
    margin: 10px 0;
  }

  .achievement-icon img {
    width: 64px;
    height: 64px;
  }

  .achievement-points {
    color: #FFD700;
    font-weight: bold;
    margin-top: 10px;
  }
`
document.head.appendChild(style)

// Export a singleton instance
export const popupManager = new PopupManager()
