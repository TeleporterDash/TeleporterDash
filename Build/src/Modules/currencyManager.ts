import { debug, setLogLevel } from "./logManager"
import { StorageManager } from "./storageManager"
setLogLevel("debug")

class CurrencyManager {
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
    this.save()
  }

  removeCoins(amount) {
    if (this.coins >= amount) {
      this.coins -= amount
      debug("CurrencyManager", `Removed ${amount} coins, total: ${this.coins}`)
      this.save()
      return true
    }
    return false
  }

  addDiamonds(amount) {
    this.diamonds += amount
    debug("CurrencyManager", `Added ${amount} diamonds, total: ${this.diamonds}`)
    this.save()
  }

  removeDiamonds(amount) {
    if (this.diamonds >= amount) {
      this.diamonds -= amount
      debug("CurrencyManager", `Removed ${amount} diamonds, total: ${this.diamonds}`)
      this.save()
      return true
    }
    return false
  }

  addExperience(amount) {
    this.experience += amount
    debug("CurrencyManager", `Added ${amount} experience, total: ${this.experience}`)
    this.save()
  }

  removeExperience(amount) {
    if (this.experience >= amount) {
      this.experience -= amount
      debug("CurrencyManager", `Removed ${amount} experience, total: ${this.experience}`)
      this.save()
      return true
    }
    return false
  }

  addLevel(amount) {
    this.level += amount
    debug("CurrencyManager", `Added ${amount} level, total: ${this.level}`)
    this.save()
  }

  removeLevel(amount) {
    if (this.level >= amount) {
      this.level -= amount
      debug("CurrencyManager", `Removed ${amount} level, total: ${this.level}`)
      this.save()
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

export const currencyManager = new CurrencyManager()