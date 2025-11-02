// Modules/logManager.js
type LogLevel =
  | "debug"
  | "verbose"
  | "error"
  | "warning"
  | "info"
  | "error/warning";
type ConsoleMethod = "log" | "warn" | "error" | "info";

const logTypes: Record<LogLevel, ConsoleMethod> = {
  debug: "log",
  verbose: "log",
  error: "error",
  warning: "warn",
  "error/warning": "error",
  info: "info",
};

type LevelState = Record<Exclude<LogLevel, "error/warning">, boolean>;

const logLevels: LevelState = {
  debug: false,
  verbose: false,
  error: true,
  warning: true,
  info: true,
};

const isKnownLevel = (level: string): level is keyof LevelState =>
  level in logLevels;

export function setLogLevel(level: LogLevel, enabled = true): void {
  if (isKnownLevel(level)) {
    logLevels[level] = enabled;
    return;
  }

  console.warn(`[logManager] Invalid log level: ${level}`);
}

export function enable(type: LogLevel): void {
  const method = logTypes[type];
  if (!method) return;
  const original = console[method];
  if (typeof original !== "function") {
    console[method] = () => {};
  }
}

export function log(moduleName: string, ...args: unknown[]): void {
  if (logLevels.info) {
    console.log(`[${moduleName}]`, ...args);
  }
}

export function warn(moduleName: string, ...args: unknown[]): void {
  if (logLevels.warning) {
    console.warn(`[${moduleName}]`, ...args);
  }
}

export function error(moduleName: string, ...args: unknown[]): void {
  if (logLevels.error) {
    console.error(`[${moduleName}]`, ...args);
  }
}

export function debug(moduleName: string, ...args: unknown[]): void {
  if (logLevels.debug) {
    console.log(`[${moduleName}]`, ...args);
  }
}

export function verbose(moduleName: string, ...args: unknown[]): void {
  if (logLevels.verbose) {
    console.log(`[${moduleName}]`, ...args);
  }
}
