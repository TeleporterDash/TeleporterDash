import { debug } from "./logManager";
import {
  StorageManager,
  storageManager as defaultStorageManager,
} from "./storageManager";

class CurrencyManager {
  private coins = 0;
  private diamonds = 0;
  private experience = 0;
  private level = 1;

  constructor(
    private readonly storage: StorageManager = defaultStorageManager
  ) {
    this.load();
  }

  addCoins(amount: number): void {
    this.coins += amount;
    debug("CurrencyManager", `Added ${amount} coins, total: ${this.coins}`);
    this.save();
  }

  removeCoins(amount: number): boolean {
    if (this.coins < amount) return false;
    this.coins -= amount;
    debug("CurrencyManager", `Removed ${amount} coins, total: ${this.coins}`);
    this.save();
    return true;
  }

  addDiamonds(amount: number): void {
    this.diamonds += amount;
    debug(
      "CurrencyManager",
      `Added ${amount} diamonds, total: ${this.diamonds}`
    );
    this.save();
  }

  removeDiamonds(amount: number): boolean {
    if (this.diamonds < amount) return false;
    this.diamonds -= amount;
    debug(
      "CurrencyManager",
      `Removed ${amount} diamonds, total: ${this.diamonds}`
    );
    this.save();
    return true;
  }

  addExperience(amount: number): void {
    this.experience += amount;
    debug(
      "CurrencyManager",
      `Added ${amount} experience, total: ${this.experience}`
    );
    this.save();
  }

  removeExperience(amount: number): boolean {
    if (this.experience < amount) return false;
    this.experience -= amount;
    debug(
      "CurrencyManager",
      `Removed ${amount} experience, total: ${this.experience}`
    );
    this.save();
    return true;
  }

  addLevel(amount: number): void {
    this.level += amount;
    debug("CurrencyManager", `Added ${amount} level, total: ${this.level}`);
    this.save();
  }

  removeLevel(amount: number): boolean {
    if (this.level < amount) return false;
    this.level -= amount;
    debug("CurrencyManager", `Removed ${amount} level, total: ${this.level}`);
    this.save();
    return true;
  }

  getState(): Readonly<{
    coins: number;
    diamonds: number;
    experience: number;
    level: number;
  }> {
    return {
      coins: this.coins,
      diamonds: this.diamonds,
      experience: this.experience,
      level: this.level,
    };
  }

  private load(): void {
    this.coins = this.storage.get("coins", 0);
    this.diamonds = this.storage.get("diamonds", 0);
    this.experience = this.storage.get("experience", 0);
    this.level = this.storage.get("level", 1);
  }

  private save(): void {
    this.storage.set("coins", this.coins);
    this.storage.set("diamonds", this.diamonds);
    this.storage.set("experience", this.experience);
    this.storage.set("level", this.level);
  }
}

export const currencyManager = new CurrencyManager();
