// Modules/popupManager.js
import { html, render } from 'lit-html';
import { warn, debug, setLogLevel } from './logManager.js';
import { applyVisualEffects } from './visualEngine.js';

setLogLevel('debug');

export class PopupManager {
  constructor({ achievementIconPath = '../Sprites/Achievements' } = {}) {
    this.popups = new Map();
    this.achievementPopups = new Map();
    this.achievementIconPath = achievementIconPath;
    this.currentErrorPopup = null;
  }

  // Generic popup template
  popupTemplate(id, content, isAchievement = false) {
    return html`
      <div
        class="popup ${isAchievement ? 'achievement-popup' : ''}"
        id="popup-${id}"
        role=${isAchievement ? 'dialog' : ''}
        aria-labelledby=${isAchievement ? `popup-${id}-title` : ''}
      >
        <div class="popup-content">${content}</div>
      </div>
    `;
  }

  // Achievement popup template
  achievementPopupTemplate(achievement) {
    return html`
      <h2 id="popup-${achievement.id}-title" class="visually-hidden">Achievement Unlocked!</h2>
      <button
        class="popup-close"
        title="Close"
        @click=${() => this.hidePopup(achievement.id, true)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path
            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            fill="white"
          />
        </svg>
      </button>
      <div class="popup-body">
        <div class="achievement-icon">
          <img
            src="${this.achievementIconPath}/${achievement.icon}.svg"
            alt="${achievement.name}"
          />
        </div>
        <h3>${achievement.name}</h3>
        <p>${achievement.description}</p>
        <span class="achievement-points">+${achievement.points} points</span>
      </div>
    `;
  }

  // Error popup template
  errorPopupTemplate(errorConfig) {
    return html`
      <div class="popup error-popup">
        <h2>${errorConfig.title || 'Error'}</h2>
        <p>${errorConfig.message || 'An unexpected error occurred.'}</p>
        ${errorConfig.details
          ? html`<pre class="error-details">${errorConfig.details}</pre>`
          : ''}
        <button @click=${() => this.hideErrorPopup()}>Close</button>
      </div>
    `;
  }

  createPopup(id, content, isAchievement = false) {
    if (!document.body) {
      warn('popupManager', 'Cannot create popup: document.body is not available.');
      return null;
    }

    const popupContainer = document.createElement('div');
    document.body.appendChild(popupContainer);
    render(this.popupTemplate(id, content, isAchievement), popupContainer);

    const popup = popupContainer.firstElementChild;
    if (isAchievement) {
      this.achievementPopups.set(id, popup);
    } else {
      this.popups.set(id, popup);
    }
    return popup;
  }

  showPopup(id, isAchievement = false) {
    const popup = isAchievement ? this.achievementPopups.get(id) : this.popups.get(id);
    if (!popup) {
      warn('popupManager', `No popup found with ID ${id}`);
      return;
    }

    popup.classList.add('active');
    popup.style.opacity = '1';
    popup.style.transition = 'opacity 0.3s ease-in-out';

    if (isAchievement) {
      applyVisualEffects(popup.querySelector('.popup-content'), { type: 'achievement' });
    }
  }

  hidePopup(id, isAchievement = false) {
    const popup = isAchievement ? this.achievementPopups.get(id) : this.popups.get(id);
    if (!popup) {
      warn('popupManager', `No popup found with ID ${id}`);
      return;
    }

    popup.classList.remove('active');
    popup.style.opacity = '0';
    setTimeout(() => {
      if (popup.parentElement) {
        popup.parentElement.remove();
      }
      if (isAchievement) {
        this.achievementPopups.delete(id);
      } else {
        this.popups.delete(id);
      }
    }, 300);
  }

  createAchievementPopup(achievement) {
    const popup = this.createPopup(achievement.id, this.achievementPopupTemplate(achievement), true);
    if (popup) {
      this.showPopup(achievement.id, true);
    }
  }

  createRegularPopup(id, content) {
    return this.createPopup(id, content, false);
  }

  showErrorPopup(errorConfig) {
    if (this.currentErrorPopup) {
      this.hideErrorPopup();
    }

    if (!document.body) {
      warn('popupManager', 'Cannot create popup: document.body is not available.');
      return null;
    }

    const popupContainer = document.createElement('div');
    document.body.appendChild(popupContainer);
    render(this.errorPopupTemplate(errorConfig), popupContainer);

    this.currentErrorPopup = popupContainer.firstElementChild;

    // Automatically close after 10 seconds
    setTimeout(() => this.hideErrorPopup(), 10000);

    return this.currentErrorPopup;
  }

  hideErrorPopup() {
    if (this.currentErrorPopup && this.currentErrorPopup.parentElement) {
      this.currentErrorPopup.parentElement.remove();
      this.currentErrorPopup = null;
    }
  }

  cleanup() {
    this.popups.forEach((popup) => popup.parentElement?.remove());
    this.achievementPopups.forEach((popup) => popup.parentElement?.remove());
    this.popups.clear();
    this.achievementPopups.clear();
    debug('popupManager', 'Popup manager cleaned up');
  }
}

// CSS
const style = document.getElementsByName('../CSS/popupManager.css');
document.head.appendChild(style);

export const popupManager = new PopupManager();