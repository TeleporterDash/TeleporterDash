import { html } from 'lit-html';
import { popupManager } from './popupManager.js';
import { currencyManager } from './currencyManager.js';

export const LevelUpManager = {
  checkLevelUp() {
    while (currencyManager.experience >= this.getRequiredExpForLevel(currencyManager.level + 1)) {
      currencyManager.addLevel(1);
      popupManager.createRegularPopup(
        'level-up',
        html`<div>Leveled up to level ${currencyManager.level}!</div>`
      );
      popupManager.showPopup('level-up');
      setTimeout(() => popupManager.hidePopup('level-up'), 3000);
    }
  },

  getRequiredExpForLevel(level) {
    // Total experience required for level N = 50 * (N-1) * N
    return 50 * (level - 1) * level;
  }
};