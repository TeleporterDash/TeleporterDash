// Modules/currencyManager.js (WIP)
import { debug, setLogLevel } from "./logManager.js"
import { StorageManager } from "./storageManager.js"
setLogLevel("debug")

export class CurrencyManager {
  constructor() {
    this.coins = 0
    this.diamonds = 0
    this.experience = 0
    this.level = 1
    this.storageManager = new StorageManager()
    this.load()
  }

  addCoins(amount) {
    this.coins += amount
    debug("CurrencyManager", `Added ${amount} coins, total: ${this.coins}`)
  }

  removeCoins(amount) {
    if (this.coins >= amount) {
      this.coins -= amount
      debug("CurrencyManager", `Removed ${amount} coins, total: ${this.coins}`)
      return true
    }
    return false
  }

  addDiamonds(amount) {
    this.diamonds += amount
    debug("CurrencyManager", `Added ${amount} diamonds, total: ${this.diamonds}`)
  }

  removeDiamonds(amount) {
    if (this.diamonds >= amount) {
      this.diamonds -= amount
      debug("CurrencyManager", `Removed ${amount} diamonds, total: ${this.diamonds}`)
      return true
    }
    return false
  }

  addExperience(amount) {
    this.experience += amount
    debug("CurrencyManager", `Added ${amount} experience, total: ${this.experience}`)
  }

  removeExperience(amount) {
    if (this.experience >= amount) {
      this.experience -= amount
      debug("CurrencyManager", `Removed ${amount} experience, total: ${this.experience}`)
      return true
    }
    return false
  }

  addLevel(amount) {
    this.level += amount
    debug("CurrencyManager", `Added ${amount} level, total: ${this.level}`)
  }

  removeLevel(amount) {
    if (this.level >= amount) {
      this.level -= amount
      debug("CurrencyManager", `Removed ${amount} level, total: ${this.level}`)
      return true
    }
    return false
  }

  load() {
    this.coins = this.storageManager.get("coins", 0)
    this.diamonds = this.storageManager.get("diamonds", 0)
    this.experience = this.storageManager.get("experience", 0)
    this.level = this.storageManager.get("level", 1)
  }

  save() {
    this.storageManager.set("coins", this.coins)
    this.storageManager.set("diamonds", this.diamonds)
    this.storageManager.set("experience", this.experience)
    this.storageManager.set("level", this.level)
  }
}
