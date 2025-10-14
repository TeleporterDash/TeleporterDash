import localforage from 'localforage'
import { warn, error, debug, verbose } from './logManager.js'

// Configure database instances
const gameDB = localforage.createInstance({
  name: 'TeleporterDashDB',
  storeName: 'gameData',
  description: 'Main game data storage'
})

const editorDB = localforage.createInstance({
  name: 'LevelEditorDB', 
  storeName: 'editorData',
  description: 'Level editor data storage'
})

const scoresDB = localforage.createInstance({
  name: 'TeleporterDashDB',
  storeName: 'scores',
  description: 'Level scores storage'
})

class StorageManager {
  // GitHub API constants
  GITHUB_API_BASE: string = 'https://api.github.com/repos/NellowTCS/TeleporterDashLevels/contents';
  GITHUB_RAW_BASE: string = 'https://raw.githubusercontent.com/NellowTCS/TeleporterDashLevels/main';
  
  // Storage keys
  SETTINGS_KEY: string = 'gameSettings';
  LEVELS_REGISTRY_KEY: string = 'userLevelsRegistry';
  NEXT_LEVEL_ID_KEY: string = 'nextLevelId';
  TEST_LEVEL_KEY: string = 'testLevel';

  constructor() {
    // Initialize (localforage handles this automatically, but keeping for compatibility)
    this.initialize();
  }

  // Initialize (localforage handles this automatically, but keeping for compatibility)
  async initialize(options = {}) {
    try {
      debug('storageManager', 'StorageManager initialized with localforage')
      return true
    } catch (err) {
      error('storageManager', 'Error initializing storage:', err)
      throw err
    }
  };

  // Generic storage methods
  async saveToStore(storeName, key, data) {
    try {
      debug('storageManager', `Saving data to ${storeName} with key ${key}`)
      const db = this.getDB(storeName)
      await db.setItem(key, data)
      debug('storageManager', `Data saved successfully to ${storeName}`)
      return true
    } catch (err) {
      error('storageManager', `Error saving to ${storeName}:`, err)
      throw err
    }
  };

  async getFromStore(storeName, key) {
    try {
      verbose('storageManager', `Getting data from ${storeName} with key ${key}`)
      const db = this.getDB(storeName)
      const result = await db.getItem(key)
      if (result !== null) {
        verbose('storageManager', `Data retrieved successfully from ${storeName}`)
      } else {
        verbose('storageManager', `No data found in ${storeName} for key ${key}`)
      }
      return result
    } catch (err) {
      error('storageManager', `Error getting from ${storeName}:`, err)
      throw err
    }
  };

  async deleteFromStore(storeName, key) {
    try {
      debug('storageManager', `Deleting data from ${storeName} with key ${key}`)
      const db = this.getDB(storeName)
      await db.removeItem(key)
      debug('storageManager', `Data deleted successfully from ${storeName}`)
      return true
    } catch (err) {
      error('storageManager', `Error deleting from ${storeName}:`, err)
      throw err
    }
  };

  async getAllFromStore(storeName) {
    try {
      debug('storageManager', `Getting all data from ${storeName}`)
      const db = this.getDB(storeName)
      const keys = await db.keys()
      const items = {}
      
      for (const key of keys) {
        items[key] = await db.getItem(key)
      }
      
      debug('storageManager', `All data retrieved successfully from ${storeName}`)
      return Object.values(items)
    } catch (err) {
      error('storageManager', `Error getting all from ${storeName}:`, err)
      throw err
    }
  };

  async clearStore(storeName) {
    try {
      debug('storageManager', `Clearing all data from ${storeName}`)
      const db = this.getDB(storeName)
      await db.clear()
      debug('storageManager', `Store ${storeName} cleared successfully`)
      return true
    } catch (err) {
      error('storageManager', `Error clearing ${storeName}:`, err)
      throw err
    }
  };

  // Helper to get the right database instance
  getDB(storeName) {
    switch (storeName) {
      case 'scores':
        return scoresDB
      case 'editor':
        return editorDB
      case 'game':
      default:
        return gameDB
    }
  };

  // LocalStorage methods (keeping for compatibility)
  saveToLocalStorage(key, data) {
    try {
      debug('storageManager', `Saving data to localStorage with key ${key}`)
      localStorage.setItem(key, JSON.stringify(data))
      debug('storageManager', 'Data saved successfully to localStorage')
      return true
    } catch (err) {
      error('storageManager', `Error saving to localStorage with key ${key}:`, err)
      throw err
    }
  };

  getFromLocalStorage(key, defaultValue = null) {
    try {
      debug('storageManager', `Getting data from localStorage with key ${key}`)
      const data = localStorage.getItem(key)
      if (data === null) {
        debug('storageManager', `No data found in localStorage for key ${key}`)
        return defaultValue
      }
      const parsed = JSON.parse(data)
      debug('storageManager', 'Data retrieved successfully from localStorage')
      return parsed
    } catch (err) {
      error('storageManager', `Error getting from localStorage with key ${key}:`, err)
      return defaultValue
    }
  };

  removeFromLocalStorage(key) {
    try {
      debug('storageManager', `Removing data from localStorage with key ${key}`)
      localStorage.removeItem(key)
      debug('storageManager', 'Data removed successfully from localStorage')
      return true
    } catch (err) {
      error('storageManager', `Error removing from localStorage with key ${key}:`, err)
      throw err
    }
  };

  hasLocalStorageKey(key) {
    return localStorage.getItem(key) !== null
  };

  // Level management
  async saveLevel(levelData) {
    return this.saveToStore('game', levelData.id, levelData)
  };

  async getLevel(levelId) {
    return this.getFromStore('game', levelId)
  };

  async deleteLevel(levelId) {
    return this.deleteFromStore('game', levelId)
  };

  async getDownloadedLevels() {
    return this.getAllFromStore('game')
  };

  async isLevelDownloaded(levelId) {
    const level = await this.getFromStore('game', levelId)
    return level !== null
  };

  async downloadLevel(filename) {
    try {
      debug('storageManager', `Downloading level ${filename}`)
      const response = await fetch(`${this.GITHUB_RAW_BASE}/${filename}`)
      const levelCode = await response.text()
      
      // Execute level code to get levelData
      const levelData = new Function(`
        window = {};
        ${levelCode}
        return window.levelData;
      `)()
      
      const levelConfig = {
        ...levelData,
        filename,
        dateDownloaded: new Date().toISOString(),
        originalCode: levelCode
      }
      
      await this.saveToStore('game', filename, levelConfig)
      debug('storageManager', `Level ${filename} downloaded successfully`)
      return levelConfig
    } catch (err) {
      error('storageManager', `Error downloading level ${filename}:`, err)
      throw err
    }
  };

  async deleteDownloadedLevel(filename) {
    return this.deleteFromStore('game', filename)
  };

  // Score management
  async saveScore(filename, time, jumps, deaths) {
    try {
      debug('storageManager', `Saving score for level ${filename}`)
      const score = {
        levelId: filename,
        time,
        jumps,
        deaths,
        timestamp: Date.now()
      }
      return this.saveToStore('scores', filename, score)
    } catch (err) {
      error('storageManager', 'Error in saveScore:', err)
      throw err
    }
  };

  async getAllScores() {
    return this.getAllFromStore('scores')
  };

  // Test level management
  async saveTestLevel(levelData) {
    try {
      debug('storageManager', 'Saving test level')
      const testLevelData = {
        ...levelData,
        id: Date.now()
      }
      await this.saveToStore('editor', this.TEST_LEVEL_KEY, testLevelData)
      debug('storageManager', 'Test level saved successfully')
      return true
    } catch (err) {
      error('storageManager', 'Error in saveTestLevel:', err)
      throw err
    }
  };

  async getTestLevel() {
    try {
      debug('storageManager', 'Getting test level')
      return this.getFromStore('editor', this.TEST_LEVEL_KEY)
    } catch (err) {
      error('storageManager', 'Error in getTestLevel:', err)
      throw err
    }
  };

  // Clear all data
  async clearAllData() {
    try {
      debug('storageManager', 'Clearing all stored data')
      
      await Promise.all([
        this.clearStore('game'),
        this.clearStore('scores'),
        this.clearStore('editor')
      ])
      
      localStorage.clear()
      debug('storageManager', 'All stored data cleared successfully')
      return true
    } catch (err) {
      error('storageManager', 'Error clearing stored data:', err)
      throw err
    }
  }
}

export const storageManager = new StorageManager();
