// Modules/logManager.js
const logTypes = {
  debug: "log",
  verbose: "log",
  error: "error",
  warning: "warn",
  "error/warning": "error",
  info: "info",
}

// Log level configuration
const logLevels = {
  debug: false,
  verbose: false,
  error: true,
  warning: true,
  info: true,
}

export function setLogLevel(level, enabled = true) {
  if (logLevels[level] !== undefined) {
    logLevels[level] = enabled
  } else {
    console.warn(`[logManager] Invalid log level: ${level}`)
  }
}

export function enable(type) {
  if (logTypes[type]) {
    console[logTypes[type]] = console[logTypes[type]] || (() => {})
  }
}

export function log(moduleName, ...args) {
  if (logLevels.info) {
    console.log(`[${moduleName}]`, ...args)
  }
}

export function warn(moduleName, ...args) {
  if (logLevels.warning) {
    console.warn(`[${moduleName}]`, ...args)
  }
}

export function error(moduleName, ...args) {
  if (logLevels.error) {
    console.error(`[${moduleName}]`, ...args)
  }
}

export function debug(moduleName, ...args) {
  if (logLevels.debug) {
    console.log(`[${moduleName}]`, ...args)
  }
}

export function verbose(moduleName, ...args) {
  if (logLevels.verbose) {
    console.log(`[${moduleName}]`, ...args)
  }
}
