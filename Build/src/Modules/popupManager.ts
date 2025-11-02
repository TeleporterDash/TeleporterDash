import { html, render, type TemplateResult } from "lit-html";
import { warn, debug, setLogLevel } from "./logManager";
import "../CSS/popupManager.css";

setLogLevel("debug");

interface PopupManagerOptions {
  achievementIconPath?: string;
}

interface AchievementData {
  id: string;
  name: string;
  description: string;
  icon: string;
  points: number;
}

interface ErrorPopupConfig {
  title?: string;
  message?: string;
  details?: string;
}

type PopupId = string;

type PopupContent = TemplateResult | string;

type PopupElement = HTMLElement;

export class PopupManager {
  private readonly achievementIconPath: string;
  private readonly popups: Map<PopupId, PopupElement>;
  private readonly achievementPopups: Map<PopupId, PopupElement>;
  private currentErrorPopup: PopupElement | null;

  constructor({
    achievementIconPath = "../Sprites/Achievements",
  }: PopupManagerOptions = {}) {
    this.popups = new Map();
    this.achievementPopups = new Map();
    this.achievementIconPath = achievementIconPath;
    this.currentErrorPopup = null;
  }

  private popupTemplate(
    id: PopupId,
    content: PopupContent,
    isAchievement = false
  ): TemplateResult {
    return html`
      <div
        class="popup ${isAchievement ? "achievement-popup" : ""}"
        id="popup-${id}"
        role=${isAchievement ? "dialog" : ""}
        aria-labelledby=${isAchievement ? `popup-${id}-title` : ""}
      >
        <div class="popup-content">${content}</div>
      </div>
    `;
  }

  private achievementPopupTemplate(
    achievement: AchievementData
  ): TemplateResult {
    return html`
      <h2 id="popup-${achievement.id}-title" class="visually-hidden">
        Achievement Unlocked!
      </h2>
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

  private errorPopupTemplate(errorConfig: ErrorPopupConfig): TemplateResult {
    return html`
      <div class="popup error-popup">
        <h2>${errorConfig.title ?? "Error"}</h2>
        <p>${errorConfig.message ?? "An unexpected error occurred."}</p>
        ${errorConfig.details
          ? html`<pre class="error-details">${errorConfig.details}</pre>`
          : ""}
        <button @click=${() => this.hideErrorPopup()}>Close</button>
      </div>
    `;
  }

  private enhanceAchievementPopup(popup: PopupElement | null): void {
    const content = popup?.querySelector<HTMLElement>(".popup-content");
    if (content) {
      content.classList.add("achievement-effect");
    }
  }

  private ensureContainer(): HTMLDivElement | null {
    if (typeof document === "undefined" || !document.body) {
      warn(
        "popupManager",
        "Cannot create popup: document.body is not available."
      );
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    return container;
  }

  createPopup(
    id: PopupId,
    content: PopupContent,
    isAchievement = false
  ): PopupElement | null {
    const container = this.ensureContainer();
    if (!container) return null;

    render(this.popupTemplate(id, content, isAchievement), container);

    const popup = container.firstElementChild as PopupElement | null;
    if (!popup) {
      container.remove();
      warn("popupManager", `Unable to render popup with ID ${id}`);
      return null;
    }

    if (isAchievement) {
      this.achievementPopups.set(id, popup);
      this.enhanceAchievementPopup(popup);
    } else {
      this.popups.set(id, popup);
    }

    return popup;
  }

  showPopup(id: PopupId, isAchievement = false): void {
    const popup = isAchievement
      ? this.achievementPopups.get(id)
      : this.popups.get(id);
    if (!popup) {
      warn("popupManager", `No popup found with ID ${id}`);
      return;
    }

    popup.classList.add("active");
    popup.style.opacity = "1";
    popup.style.transition = "opacity 0.3s ease-in-out";
  }

  hidePopup(id: PopupId, isAchievement = false): void {
    const popup = isAchievement
      ? this.achievementPopups.get(id)
      : this.popups.get(id);
    if (!popup) {
      warn("popupManager", `No popup found with ID ${id}`);
      return;
    }

    popup.classList.remove("active");
    popup.style.opacity = "0";
    setTimeout(() => {
      popup.parentElement?.remove();
      if (isAchievement) {
        this.achievementPopups.delete(id);
      } else {
        this.popups.delete(id);
      }
    }, 300);
  }

  createAchievementPopup(achievement: AchievementData): void {
    const popup = this.createPopup(
      achievement.id,
      this.achievementPopupTemplate(achievement),
      true
    );
    if (popup) {
      this.showPopup(achievement.id, true);
    }
  }

  createRegularPopup(id: PopupId, content: PopupContent): PopupElement | null {
    return this.createPopup(id, content, false);
  }

  showErrorPopup(errorConfig: ErrorPopupConfig): PopupElement | null {
    if (this.currentErrorPopup) {
      this.hideErrorPopup();
    }

    const container = this.ensureContainer();
    if (!container) return null;

    render(this.errorPopupTemplate(errorConfig), container);

    this.currentErrorPopup = container.firstElementChild as PopupElement | null;

    if (this.currentErrorPopup) {
      setTimeout(() => this.hideErrorPopup(), 10_000);
    } else {
      container.remove();
    }

    return this.currentErrorPopup;
  }

  hideErrorPopup(): void {
    if (this.currentErrorPopup?.parentElement) {
      this.currentErrorPopup.parentElement.remove();
    }
    this.currentErrorPopup = null;
  }

  cleanup(): void {
    this.popups.forEach((popup) => popup.parentElement?.remove());
    this.achievementPopups.forEach((popup) => popup.parentElement?.remove());
    this.popups.clear();
    this.achievementPopups.clear();
    debug("popupManager", "Popup manager cleaned up");
  }
}

export const popupManager = new PopupManager();
