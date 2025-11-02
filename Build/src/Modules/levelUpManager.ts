import { html } from "lit-html";
import { popupManager } from "./popupManager";
import { currencyManager } from "./currencyManager";

type LevelUpManagerContract = {
  checkLevelUp(): void;
  getRequiredExpForLevel(level: number): number;
};

export const LevelUpManager: LevelUpManagerContract = {
  checkLevelUp(): void {
    // Loop until experience no longer meets the requirement for next level
    while (true) {
      const { experience, level } = currencyManager.getState();
      const requiredExp = this.getRequiredExpForLevel(level + 1);
      if (experience < requiredExp) break;

      currencyManager.addLevel(1);
      const { level: newLevel } = currencyManager.getState();
      popupManager.createRegularPopup(
        "level-up",
        html`<div>Leveled up to level ${newLevel}!</div>`
      );
      popupManager.showPopup("level-up");
      setTimeout(() => popupManager.hidePopup("level-up"), 3000);
    }
  },

  getRequiredExpForLevel(level: number): number {
    // Total experience required for level N = 50 * (N-1) * N
    return 50 * (level - 1) * level;
  },
};
