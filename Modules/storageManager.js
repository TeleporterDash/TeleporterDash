/**
 * StorageManager
 * Handles all storage-related functionality for Teleporter Dash
 * Including localStorage, sessionStorage, and IndexedDB operations
 */

import { warn, error, debug, verbose, setLogLevel } from "./logManager.js"

setLogLevel("debug", true)

const StorageManager = {
  // Database constants
  DB_NAME: "TeleporterDashDB",
  DB_VERSION: 1,
  EDITOR_DB_NAME: "LevelEditorDB",
  EDITOR_DB_VERSION: 1,
  LEVELS_STORE: "downloadedLevels",
  SCORES_STORE: "levelScores",
  TEST_LEVEL_STORE: "testLevel",
  DRAFTS_STORE: "levelDrafts",

  // GitHub API base URLs
  GITHUB_API_BASE: "https://api.github.com/repos/NellowTCS/TeleporterDashLevels/contents",
  GITHUB_RAW_BASE: "https://raw.githubusercontent.com/NellowTCS/TeleporterDashLevels/main",

  // Database references
  db: null,
  editorDb: null,
  // Initialization state
  isInitialized: false,
  initializationPromise: null,

  // LocalStorage keys
  SETTINGS_KEY: "gameSettings",
  LEVELS_REGISTRY_KEY: "userLevelsRegistry",
  NEXT_LEVEL_ID_KEY: "nextLevelId",

  /**
   * Initialize the storage system
   * @param {Object} options - Configuration options
   * @param {boolean} options.initEditorDB - Whether to initialize the level editor database
   * @returns {Promise} A promise that resolves when initialization is complete
   */
  async initialize(options = {}) {
    // If initialization is already in progress, return the existing promise
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // If already initialized, return immediately
    if (this.isInitialized) {
      debug("storageManager", "StorageManager already initialized")
      return true
    }

    try {
      debug("storageManager", "Initializing main game database")
      this.initializationPromise = this.initIndexedDB()
      await this.initializationPromise

      // Initialize level editor database if requested
      if (options.initEditorDB) {
        debug("storageManager", "Initializing editor database")
        await this.initEditorDB(options)
      }

      debug("storageManager", "StorageManager initialization completed successfully")
      this.isInitialized = true
      return true
    } catch (error) {
      error("storageManager", "Error initializing storage:", error)
      throw error
    } finally {
      this.initializationPromise = null
    }
  },

  /**
   * Get the editor database reference
   * @returns {IDBDatabase|null} The editor database reference or null if not initialized
   */
  getEditorDb() {
    return this.editorDb
  },

  /**
   * Initialize IndexedDB for game data
   * @returns {Promise} A promise that resolves when database is ready
   */
  async initIndexedDB() {
    debug("storageManager", "Initializing IndexedDB for game data")
    const request = indexedDB.open(this.DB_NAME, this.DB_VERSION)

    return new Promise((resolve, reject) => {
      request.onupgradeneeded = (event) => {
        debug("storageManager", "IndexedDB upgrade needed")
        const db = event.target.result

        // Create stores if they don't exist
        if (!db.objectStoreNames.contains(this.LEVELS_STORE)) {
          db.createObjectStore(this.LEVELS_STORE)
        }
        if (!db.objectStoreNames.contains(this.SCORES_STORE)) {
          db.createObjectStore(this.SCORES_STORE)
        }
        if (!db.objectStoreNames.contains(this.TEST_LEVEL_STORE)) {
          db.createObjectStore(this.TEST_LEVEL_STORE)
        }
      }

      request.onsuccess = (event) => {
        this.db = event.target.result
        debug("storageManager", "IndexedDB initialized successfully")
        resolve(true)
      }

      request.onerror = (event) => {
        error("storageManager", "Error initializing IndexedDB:", event.target.error)
        reject(event.target.error)
      }
    })
  },

  /**
   * Initialize IndexedDB for level editor
   * @param {Object} options - Configuration options
   * @returns {Promise} A promise that resolves when database is ready
   */
  async initEditorDB(options = {}) {
    try {
      debug("storageManager", "Initializing editor IndexedDB")
      const request = indexedDB.open(this.EDITOR_DB_NAME, this.EDITOR_DB_VERSION)
      let resolvePromise, rejectPromise

      const initPromise = new Promise((resolve, reject) => {
        resolvePromise = resolve
        rejectPromise = reject
      })

      request.onupgradeneeded = (event) => {
        debug("storageManager", "Editor IndexedDB upgrade needed")
        const db = event.target.result

        // Create stores if they don't exist
        if (!db.objectStoreNames.contains(this.DRAFTS_STORE)) {
          db.createObjectStore(this.DRAFTS_STORE)
        }
      }

      request.onsuccess = (event) => {
        this.editorDb = event.target.result
        debug("storageManager", "Editor IndexedDB initialized successfully")
        resolvePromise(true)
      }

      request.onerror = (event) => {
        error("storageManager", "Error initializing editor IndexedDB:", event.target.error)
        rejectPromise(event.target.error)
      }

      return initPromise
    } catch (error) {
      error("storageManager", "Error in editor IndexedDB initialization:", error)
      throw error
    }
  },

  /**
   * Create a new object store in the main database
   * @param {string} storeName - Name of the store to create
   * @param {Object} options - Optional configuration for the object store
   * @returns {Promise<boolean>} True if store was created successfully
   */
  async createStore(storeName, options = {}) {
    try {
      debug("storageManager", `Attempting to create new store: ${storeName}`)

      // This operation requires database version upgrade
      const newVersion = this.db.version + 1
      this.db.close()

      const request = indexedDB.open(this.DB_NAME, newVersion)

      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, options)
          debug("storageManager", `Store ${storeName} created successfully`)
        }
      }

      return new Promise((resolve, reject) => {
        request.onsuccess = async (event) => {
          this.db = event.target.result

          // Automatically reinitialize to ensure new store is recognized
          try {
            await this.initialize()
            debug("storageManager", `Store ${storeName} initialized and ready`)
            resolve(true)
          } catch (initError) {
            error("storageManager", `Error reinitializing after creating store ${storeName}:`, initError)
            reject(initError)
          }
        }

        request.onerror = () => reject(request.error)
      })
    } catch (err) {
      error("storageManager", `Error creating store ${storeName}:`, err)
      throw err
    }
  },

  /**
   * Generic method to save data to any IndexedDB store
   * @param {string} storeName - Name of the store to save to
   * @param {string|number} key - Key to save the data under
   * @param {any} data - Data to save
   * @param {Object} dbRef - Optional database reference (defaults to main db)
   * @returns {Promise<boolean>} True if save was successful
   */
  async saveToStore(storeName, key, data, dbRef = null) {
    try {
      const db = dbRef || this.db
      if (!db) {
        throw new Error("Database not initialized")
      }

      debug("storageManager", `Saving data to store ${storeName} with key ${key}`)

      if (!db.objectStoreNames.contains(storeName)) {
        warn("storageManager", `Store ${storeName} does not exist`)
        throw new Error(`Store ${storeName} does not exist`)
      }

      const transaction = db.transaction([storeName], "readwrite")
      const store = transaction.objectStore(storeName)
      const request = store.put(data, key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          debug("storageManager", `Data saved successfully to ${storeName}`)
          resolve(true)
        }
        request.onerror = () => {
          error("storageManager", `Error saving data to ${storeName}:`, request.error)
          reject(request.error)
        }
      })
    } catch (err) {
      error("storageManager", `Error in saveToStore for ${storeName}:`, err)
      throw err
    }
  },

  /**
   * Generic method to get data from any IndexedDB store
   * @param {string} storeName - Name of the store to retrieve from
   * @param {string|number} key - Key to retrieve
   * @param {Object} dbRef - Optional database reference (defaults to main db)
   * @returns {Promise<any>} The retrieved data or null if not found
   */
  async getFromStore(storeName, key, dbRef = null) {
    try {
      const db = dbRef || this.db
      if (!db) {
        throw new Error("Database not initialized")
      }

      verbose("storageManager", `Getting data from store ${storeName} with key ${key}`)

      if (!db.objectStoreNames.contains(storeName)) {
        warn("storageManager", `Store ${storeName} does not exist`)
        throw new Error(`Store ${storeName} does not exist`)
      }

      const transaction = db.transaction([storeName], "readonly")
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          if (request.result !== undefined) {
            verbose("storageManager", `Data retrieved successfully from ${storeName}`)
            resolve(request.result)
          } else {
            verbose("storageManager", `No data found in ${storeName} for key ${key}`)
            resolve(null)
          }
        }
        request.onerror = () => {
          error("storageManager", `Error getting data from ${storeName}:`, request.error)
          reject(request.error)
        }
      })
    } catch (err) {
      error("storageManager", `Error in getFromStore for ${storeName}:`, err)
      throw err
    }
  },

  /**
   * Generic method to delete data from any IndexedDB store
   * @param {string} storeName - Name of the store to delete from
   * @param {string|number} key - Key to delete
   * @param {Object} dbRef - Optional database reference (defaults to main db)
   * @returns {Promise<boolean>} True if deletion was successful
   */
  async deleteFromStore(storeName, key, dbRef = null) {
    try {
      const db = dbRef || this.db
      if (!db) {
        throw new Error("Database not initialized")
      }

      debug("storageManager", `Deleting data from store ${storeName} with key ${key}`)

      if (!db.objectStoreNames.contains(storeName)) {
        warn("storageManager", `Store ${storeName} does not exist`)
        throw new Error(`Store ${storeName} does not exist`)
      }

      const transaction = db.transaction([storeName], "readwrite")
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          debug("storageManager", `Data deleted successfully from ${storeName}`)
          resolve(true)
        }
        request.onerror = () => {
          error("storageManager", `Error deleting data from ${storeName}:`, request.error)
          reject(request.error)
        }
      })
    } catch (err) {
      error("storageManager", `Error in deleteFromStore for ${storeName}:`, err)
      throw err
    }
  },

  /**
   * Get all data from a store
   * @param {string} storeName - Name of the store to retrieve from
   * @param {Object} dbRef - Optional database reference (defaults to main db)
   * @returns {Promise<Array>} Array of all data in the store
   */
  async getAllFromStore(storeName, dbRef = null) {
    try {
      const db = dbRef || this.db
      if (!db) {
        throw new Error("Database not initialized")
      }

      debug("storageManager", `Getting all data from store ${storeName}`)

      if (!db.objectStoreNames.contains(storeName)) {
        warn("storageManager", `Store ${storeName} does not exist`)
        throw new Error(`Store ${storeName} does not exist`)
      }

      const transaction = db.transaction([storeName], "readonly")
      const store = transaction.objectStore(storeName)
      const request = store.getAll()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          debug("storageManager", `All data retrieved successfully from ${storeName}`)
          resolve(request.result)
        }
        request.onerror = () => {
          error("storageManager", `Error getting all data from ${storeName}:`, request.error)
          reject(request.error)
        }
      })
    } catch (err) {
      error("storageManager", `Error in getAllFromStore for ${storeName}:`, err)
      throw err
    }
  },

  /**
   * Clear all data from a store
   * @param {string} storeName - Name of the store to clear
   * @param {Object} dbRef - Optional database reference (defaults to main db)
   * @returns {Promise<boolean>} True if clear was successful
   */
  async clearStore(storeName, dbRef = null) {
    try {
      const db = dbRef || this.db
      if (!db) {
        throw new Error("Database not initialized")
      }

      debug("storageManager", `Clearing all data from store ${storeName}`)

      if (!db.objectStoreNames.contains(storeName)) {
        warn("storageManager", `Store ${storeName} does not exist`)
        throw new Error(`Store ${storeName} does not exist`)
      }

      const transaction = db.transaction([storeName], "readwrite")
      const store = transaction.objectStore(storeName)
      const request = store.clear()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          debug("storageManager", `Store ${storeName} cleared successfully`)
          resolve(true)
        }
        request.onerror = () => {
          error("storageManager", `Error clearing store ${storeName}:`, request.error)
          reject(request.error)
        }
      })
    } catch (err) {
      error("storageManager", `Error in clearStore for ${storeName}:`, err)
      throw err
    }
  },

  /**
   * Save data to localStorage with JSON serialization
   * @param {string} key - Key to save under
   * @param {any} data - Data to save (will be JSON serialized)
   * @returns {boolean} True if save was successful
   */
  saveToLocalStorage(key, data) {
    try {
      debug("storageManager", `Saving data to localStorage with key ${key}`)
      const serializedData = JSON.stringify(data)
      localStorage.setItem(key, serializedData)
      debug("storageManager", `Data saved successfully to localStorage`)
      return true
    } catch (err) {
      error("storageManager", `Error saving to localStorage with key ${key}:`, err)
      if (err instanceof TypeError && err.message.includes("circular structure")) {
        warn("storageManager", "Attempted to save circular structure to localStorage")
      }
      throw err
    }
  },

  /**
   * Get data from localStorage with JSON parsing
   * @param {string} key - Key to retrieve
   * @param {any} defaultValue - Default value to return if key doesn't exist
   * @returns {any} The retrieved data or defaultValue if not found
   */
  getFromLocalStorage(key, defaultValue = null) {
    try {
      debug("storageManager", `Getting data from localStorage with key ${key}`)
      const serializedData = localStorage.getItem(key)

      if (serializedData === null) {
        debug("storageManager", `No data found in localStorage for key ${key}`)
        return defaultValue
      }

      const data = JSON.parse(serializedData)
      debug("storageManager", `Data retrieved successfully from localStorage`)
      return data
    } catch (err) {
      error("storageManager", `Error getting from localStorage with key ${key}:`, err)
      if (err instanceof SyntaxError) {
        warn("storageManager", `Invalid JSON in localStorage for key ${key}`)
        // In case of corrupt data, remove it and return default
        localStorage.removeItem(key)
      }
      return defaultValue
    }
  },

  /**
   * Remove data from localStorage
   * @param {string} key - Key to remove
   * @returns {boolean} True if removal was successful
   */
  removeFromLocalStorage(key) {
    try {
      debug("storageManager", `Removing data from localStorage with key ${key}`)
      localStorage.removeItem(key)
      debug("storageManager", `Data removed successfully from localStorage`)
      return true
    } catch (err) {
      error("storageManager", `Error removing from localStorage with key ${key}:`, err)
      throw err
    }
  },

  /**
   * Check if a key exists in localStorage
   * @param {string} key - Key to check
   * @returns {boolean} True if key exists
   */
  hasLocalStorageKey(key) {
    return localStorage.getItem(key) !== null
  },

  /**
   * Save a level to IndexedDB
   * @param {Object} levelData - The level data to save
   * @returns {Promise} A promise that resolves when save is complete
   */
  async saveLevel(levelData) {
    return this.saveToStore(this.LEVELS_STORE, levelData.id, levelData)
  },

  /**
   * Get a level from IndexedDB
   * @param {string} levelId - The ID of the level to retrieve
   * @returns {Promise<Object>} The level data or null if not found
   */
  async getLevel(levelId) {
    return this.getFromStore(this.LEVELS_STORE, levelId)
  },

  /**
   * Delete a level from IndexedDB
   * @param {string} levelId - The ID of the level to delete
   * @returns {Promise} A promise that resolves when deletion is complete
   */
  async deleteLevel(levelId) {
    return this.deleteFromStore(this.LEVELS_STORE, levelId)
  },

  /**
   * Save a score to IndexedDB
   * @param {Object} scoreData - The score data to save
   * @returns {Promise} A promise that resolves when save is complete
   */
  async saveScore(filename, time, jumps, deaths) {
    try {
      debug("storageManager", `Saving score for level ${filename}`)
      const score = {
        levelId: filename,
        time: time,
        jumps: jumps,
        deaths: deaths,
        timestamp: Date.now(),
      }
      return this.saveToStore(this.SCORES_STORE, filename, score)
    } catch (error) {
      error("storageManager", "Error in saveScore:", error)
      throw error
    }
  },

  /**
   * Get all scores from IndexedDB
   * @returns {Promise<Array>} Array of all score data
   */
  async getAllScores() {
    return this.getAllFromStore(this.SCORES_STORE)
  },

  /**
   * Clear all stored data
   * @returns {Promise} A promise that resolves when cleanup is complete
   */
  async clearAllData() {
    try {
      debug("storageManager", "Clearing all stored data")

      // Clear IndexedDB
      if (this.db) {
        debug("storageManager", "Clearing IndexedDB")
        const storeNames = Array.from(this.db.objectStoreNames)
        const clearPromises = storeNames.map((storeName) => this.clearStore(storeName))
        await Promise.all(clearPromises)
        debug("storageManager", "IndexedDB cleared successfully")
      }

      // Clear localStorage
      localStorage.clear()
      debug("storageManager", "localStorage cleared successfully")

      // Clear editor database
      if (this.editorDb) {
        debug("storageManager", "Clearing editor database")
        const editorStoreNames = Array.from(this.editorDb.objectStoreNames)
        const clearPromises = editorStoreNames.map((storeName) => this.clearStore(storeName, this.editorDb))
        await Promise.all(clearPromises)
        debug("storageManager", "Editor database cleared successfully")
      }

      debug("storageManager", "All stored data cleared successfully")
      return true
    } catch (error) {
      error("storageManager", "Error clearing stored data:", error)
      throw error
    }
  },
  /**
   * Get all downloaded levels from IndexedDB
   * @returns {Promise<Array>} Array of all downloaded level data
   */
  async getDownloadedLevels() {
    try {
      if (!this.db) {
        throw new Error("StorageManager not initialized")
      }

      return await this.getAllFromStore(this.LEVELS_STORE)
    } catch (err) {
      error("storageManager", "Error getting downloaded levels:", err)
      throw err
    }
  },

  /**
   * Check if a level is downloaded
   * @param {string} levelId - The ID of the level to check
   * @returns {Promise<boolean>} True if the level is downloaded
   */
  async isLevelDownloaded(levelId) {
    try {
      if (!this.db) {
        throw new Error("StorageManager not initialized")
      }

      const level = await this.getFromStore(this.LEVELS_STORE, levelId)
      return level !== null
    } catch (err) {
      error("storageManager", `Error checking if level ${levelId} is downloaded:`, err)
      throw err
    }
  },

  /**
   * Download and save a level from GitHub
   * @param {string} filename - The filename of the level to download
   * @returns {Promise<Object>} The downloaded level data
   */
  async downloadLevel(filename) {
    try {
      if (!this.db) {
        throw new Error("StorageManager not initialized")
      }

      // Fetch level data from GitHub
      const response = await fetch(`${this.GITHUB_RAW_BASE}/${filename}`)
      const levelCode = await response.text()
      debug("storageManager", `Fetched level code for ${filename}`)

      // Create a temporary environment to evaluate the level data
      const levelData = new Function(`
                window = {};
                ${levelCode}
                return window.levelData;
            `)()

      // Add download metadata
      const levelConfig = {
        ...levelData,
        filename,
        dateDownloaded: new Date().toISOString(),
        originalCode: levelCode,
      }

      // Save to IndexedDB
      await this.saveToStore(this.LEVELS_STORE, filename, levelConfig)

      debug("storageManager", `Level ${filename} downloaded successfully`)
      return levelConfig
    } catch (err) {
      error("storageManager", `Error downloading level ${filename}:`, err)
      throw err
    }
  },

  /**
   * Delete a downloaded level from IndexedDB
   * @param {string} filename - The filename of the level to delete
   * @returns {Promise<boolean>} True if deletion was successful
   */
  async deleteDownloadedLevel(filename) {
    try {
      if (!this.db) {
        throw new Error("StorageManager not initialized")
      }

      await this.deleteFromStore(this.LEVELS_STORE, filename)
      debug("storageManager", `Level ${filename} deleted successfully`)
      return true
    } catch (err) {
      error("storageManager", `Error deleting level ${filename}:`, err)
      throw err
    }
  },

  /**
   * Save a test level to IndexedDB
   * @param {Object} levelData - The test level data to save
   * @returns {Promise} A promise that resolves when save is complete
   */
  async saveTestLevel(levelData) {
    try {
      debug("storageManager", "Saving test level to IndexedDB")
      const editorDb = await this.getEditorDb()
      if (!editorDb) {
        throw new Error("Editor database not initialized")
      }

      // Create a single transaction for both operations
      const transaction = editorDb.transaction([this.TEST_LEVEL_STORE], "readwrite")
      const store = transaction.objectStore(this.TEST_LEVEL_STORE)

      // Clear existing test level
      const clearRequest = store.clear()

      // Save the new test level with an ID
      const saveRequest = (clearRequest.onsuccess = () => {
        // Add a timestamp-based ID to ensure uniqueness
        const testLevelData = {
          ...levelData,
          id: Date.now(), // Use timestamp as ID
        }

        const addRequest = store.add(testLevelData)

        addRequest.onsuccess = () => {
          debug("storageManager", "Test level saved successfully")
        }

        addRequest.onerror = () => {
          const error = addRequest.error
          error("storageManager", "Error adding test level:", error)
          throw error
        }
      })

      clearRequest.onerror = () => {
        const error = clearRequest.error
        error("storageManager", "Error clearing test level:", error)
        throw error
      }

      // Wait for the transaction to complete
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve(true)
        }

        transaction.onerror = () => {
          const error = transaction.error
          error("storageManager", "Error in transaction:", error)
          reject(error)
        }
      })
    } catch (error) {
      error("storageManager", "Error in saveTestLevel:", error)
      throw error
    }
  },

  /**
   * Get the test level from IndexedDB
   * @returns {Promise<Object|null>} The test level data or null if not found
   */
  async getTestLevel() {
    try {
      debug("storageManager", "Getting test level from IndexedDB")

      // Ensure editor database is initialized
      if (!this.editorDb) {
        await this.initEditorDB({ initEditorDB: true })
      }

      const editorDb = this.editorDb
      if (!editorDb) {
        throw new Error("Editor database not initialized")
      }

      const transaction = editorDb.transaction([this.TEST_LEVEL_STORE], "readonly")
      const store = transaction.objectStore(this.TEST_LEVEL_STORE)
      const request = store.getAll()

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const levels = request.result
          resolve(levels && levels.length > 0 ? levels[0] : null)
        }

        request.onerror = () => {
          const error = request.error
          error("storageManager", "Error getting test level:", error)
          reject(error)
        }
      })
    } catch (error) {
      error("storageManager", "Error in getTestLevel:", error)
      throw error
    }
  },
}

export { StorageManager }
