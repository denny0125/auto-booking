export type LogLevel = "debug" | "info" | "warn" | "error";

export type LoggerContext = Record<string, unknown>;

export type Logger = {
  debug: (message: string, context?: LoggerContext) => void;
  info: (message: string, context?: LoggerContext) => void;
  warn: (message: string, context?: LoggerContext) => void;
  error: (message: string, context?: LoggerContext) => void;
};

const sensitiveKeyPattern = /(pass|password|secret|token|authorization|cookie|smtp)/i;

export function createLogger(defaultContext: LoggerContext = {}): Logger {
  return {
    debug: (message, context) => writeLog("debug", message, defaultContext, context),
    info: (message, context) => writeLog("info", message, defaultContext, context),
    warn: (message, context) => writeLog("warn", message, defaultContext, context),
    error: (message, context) => writeLog("error", message, defaultContext, context),
  };
}

export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.length <= 4) {
      return "[REDACTED]";
    }

    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(entry));
  }

  if (value && typeof value === "object") {
    return redactContext(value as Record<string, unknown>);
  }

  return value;
}

export function redactContext(context: LoggerContext): LoggerContext {
  const redactedEntries = Object.entries(context).map(([key, value]) => {
    if (sensitiveKeyPattern.test(key)) {
      return [key, redactSensitiveValue(value)];
    }

    if (value && typeof value === "object") {
      return [key, redactSensitiveValue(value)];
    }

    return [key, value];
  });

  return Object.fromEntries(redactedEntries);
}

function writeLog(
  level: LogLevel,
  message: string,
  defaultContext: LoggerContext,
  runtimeContext?: LoggerContext,
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redactContext(defaultContext),
    ...(runtimeContext ? redactContext(runtimeContext) : {}),
  };

  console.log(JSON.stringify(payload));
}