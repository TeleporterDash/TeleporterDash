import localforage from "localforage";
import { warn, error, debug, verbose } from "./logManager";

type StoreName = "game" | "editor" | "scores";

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | SerializableObject;

interface SerializableObject {
  [key: string]: Serializable;
}

interface StoredLevelSummary extends SerializableObject {
  levelId: string;
  time: number;
  jumps: number;
  deaths: number;
  timestamp: number;
}

interface StoredScore extends SerializableObject {
  levelId: string;
  time: number;
  jumps: number;
  deaths: number;
  timestamp: number;
}

interface DownloadedLevel extends SerializableObject {
  filename: string;
  dateDownloaded: string;
  originalCode: string;
}

type StoreInstance = ReturnType<typeof localforage.createInstance>;
type StoreRecord = Readonly<Record<StoreName, StoreInstance>>;

const stores: StoreRecord = {
  game: localforage.createInstance({
    name: "TeleporterDashDB",
    storeName: "gameData",
    description: "Main game data storage",
  }),
  editor: localforage.createInstance({
    name: "LevelEditorDB",
    storeName: "editorData",
    description: "Level editor data storage",
  }),
  scores: localforage.createInstance({
    name: "TeleporterDashDB",
    storeName: "scores",
    description: "Level scores storage",
  }),
};

const isSerializable = (value: unknown): value is Serializable => {
  if (value === null) return true;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isSerializable);
  }
  if (typeof value === "object") {
    return Object.values(value as SerializableObject).every(isSerializable);
  }
  return false;
};

export class StorageManager {
  readonly GITHUB_API_BASE =
    "https://api.github.com/repos/NellowTCS/TeleporterDashLevels/contents";
  readonly GITHUB_RAW_BASE =
    "https://raw.githubusercontent.com/NellowTCS/TeleporterDashLevels/main";

  readonly SETTINGS_KEY = "gameSettings";
  readonly LEVELS_REGISTRY_KEY = "userLevelsRegistry";
  readonly NEXT_LEVEL_ID_KEY = "nextLevelId";
  readonly TEST_LEVEL_KEY = "testLevel";

  constructor() {
    void this.initialize();
  }

  async initialize(): Promise<void> {
    debug("storageManager", "StorageManager initialized with localforage");
  }

  async saveToStore<T extends Serializable>(
    storeName: StoreName,
    key: string,
    data: T
  ): Promise<void> {
    if (!isSerializable(data)) {
      throw new TypeError("Attempted to persist non-serializable data");
    }

    debug("storageManager", `Saving data to ${storeName} with key ${key}`);
    await stores[storeName].setItem(key, data);
    debug("storageManager", `Data saved successfully to ${storeName}`);
  }

  async getFromStore<T extends Serializable>(
    storeName: StoreName,
    key: string
  ): Promise<T | null> {
    verbose("storageManager", `Getting data from ${storeName} with key ${key}`);
    const result = (await stores[storeName].getItem<T>(key)) ?? null;
    if (result !== null) {
      verbose(
        "storageManager",
        `Data retrieved successfully from ${storeName}`
      );
    } else {
      verbose("storageManager", `No data found in ${storeName} for key ${key}`);
    }
    return result;
  }

  async deleteFromStore(storeName: StoreName, key: string): Promise<void> {
    debug("storageManager", `Deleting data from ${storeName} with key ${key}`);
    await stores[storeName].removeItem(key);
    debug("storageManager", `Data deleted successfully from ${storeName}`);
  }

  async getAllFromStore<T extends Serializable>(
    storeName: StoreName
  ): Promise<T[]> {
    debug("storageManager", `Getting all data from ${storeName}`);
    const db = stores[storeName];
    const keys = await db.keys();
    const items: T[] = [];

    for (const key of keys) {
      if (!key) {
        warn("storageManager", `Null or empty key found in ${storeName}`);
        continue;
      }

      const value = await db.getItem<T>(key);
      if (value !== null) {
        items.push(value);
      }
    }

    debug(
      "storageManager",
      `All data retrieved successfully from ${storeName}`
    );
    return items;
  }

  async clearStore(storeName: StoreName): Promise<void> {
    debug("storageManager", `Clearing all data from ${storeName}`);
    await stores[storeName].clear();
    debug("storageManager", `Store ${storeName} cleared successfully`);
  }

  saveToLocalStorage<T extends Serializable>(key: string, data: T): void {
    if (!isSerializable(data)) {
      throw new TypeError("Attempted to persist non-serializable data");
    }

    debug("storageManager", `Saving data to localStorage with key ${key}`);
    localStorage.setItem(key, JSON.stringify(data));
    debug("storageManager", "Data saved successfully to localStorage");
  }

  getFromLocalStorage<T extends Serializable>(
    key: string,
    defaultValue: T | null = null
  ): T | null {
    debug("storageManager", `Getting data from localStorage with key ${key}`);
    const raw = localStorage.getItem(key);
    if (raw === null) {
      debug("storageManager", `No data found in localStorage for key ${key}`);
      return defaultValue;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      error(
        "storageManager",
        `Error parsing localStorage value for key ${key}:`,
        err
      );
      return defaultValue;
    }
  }

  removeFromLocalStorage(key: string): void {
    debug("storageManager", `Removing data from localStorage with key ${key}`);
    localStorage.removeItem(key);
    debug("storageManager", "Data removed successfully from localStorage");
  }

  hasLocalStorageKey(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }

  get<T extends Serializable>(key: string, defaultValue: T): T {
    return this.getFromLocalStorage<T>(key, defaultValue) ?? defaultValue;
  }

  set<T extends Serializable>(key: string, value: T): void {
    this.saveToLocalStorage(key, value);
  }

  async saveLevel(levelData: StoredLevelSummary): Promise<void> {
    await this.saveToStore("game", levelData.levelId, levelData);
  }

  async getLevel<T extends Serializable>(levelId: string): Promise<T | null> {
    return this.getFromStore<T>("game", levelId);
  }

  async deleteLevel(levelId: string): Promise<void> {
    await this.deleteFromStore("game", levelId);
  }

  async getDownloadedLevels<T extends Serializable>(): Promise<T[]> {
    return this.getAllFromStore<T>("game");
  }

  async isLevelDownloaded(levelId: string): Promise<boolean> {
    const level = await this.getFromStore<Serializable>("game", levelId);
    return level !== null;
  }

  async downloadLevel(filename: string): Promise<DownloadedLevel> {
    debug("storageManager", `Downloading level ${filename}`);
    const response = await fetch(`${this.GITHUB_RAW_BASE}/${filename}`);
    if (!response.ok) {
      throw new Error(
        `Failed to download level: ${response.status} ${response.statusText}`
      );
    }

    const levelCode = await response.text();

    const levelData = new Function(
      "code",
      `
        const sandbox = {}
        const window = sandbox
        ;(function(){
          // eslint-disable-next-line no-eval
          eval(code)
        }).call(sandbox)
        if (!sandbox.levelData) {
          throw new Error('Level data not found in downloaded script')
        }
        return sandbox.levelData
      `
    )(levelCode) as Record<string, Serializable>;

    const levelConfig: DownloadedLevel = {
      ...levelData,
      filename,
      dateDownloaded: new Date().toISOString(),
      originalCode: levelCode,
    };

    await this.saveToStore("game", filename, levelConfig);
    debug("storageManager", `Level ${filename} downloaded successfully`);
    return levelConfig;
  }

  async deleteDownloadedLevel(filename: string): Promise<void> {
    await this.deleteFromStore("game", filename);
  }

  async saveScore(
    filename: string,
    time: number,
    jumps: number,
    deaths: number
  ): Promise<void> {
    debug("storageManager", `Saving score for level ${filename}`);
    const score: StoredScore = {
      levelId: filename,
      time,
      jumps,
      deaths,
      timestamp: Date.now(),
    };
    await this.saveToStore("scores", filename, score);
  }

  async getAllScores(): Promise<StoredScore[]> {
    return this.getAllFromStore<StoredScore>("scores");
  }

  async saveTestLevel(levelData: Record<string, Serializable>): Promise<void> {
    debug("storageManager", "Saving test level");
    const testLevelData: Record<string, Serializable> = {
      ...levelData,
      id: Date.now(),
    };
    await this.saveToStore("editor", this.TEST_LEVEL_KEY, testLevelData);
    debug("storageManager", "Test level saved successfully");
  }

  async getTestLevel<T extends Serializable>(): Promise<T | null> {
    debug("storageManager", "Getting test level");
    return this.getFromStore<T>("editor", this.TEST_LEVEL_KEY);
  }

  async clearAllData(): Promise<void> {
    debug("storageManager", "Clearing all stored data");
    await Promise.all([
      this.clearStore("game"),
      this.clearStore("scores"),
      this.clearStore("editor"),
    ]);
    localStorage.clear();
    debug("storageManager", "All stored data cleared successfully");
  }
}

export const storageManager = new StorageManager();
