/** Minimal stderr logger. stdout is reserved for the stdio MCP transport. */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): number {
  const raw = (process.env.IMMICH_MCP_LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVELS[raw] ?? LEVELS.info;
}

function emit(level: Level, message: string, meta?: unknown) {
  if (LEVELS[level] < currentLevel()) return;
  const time = new Date().toISOString();
  const line = `${time} [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) {
    process.stderr.write(line + "\n");
  } else {
    process.stderr.write(`${line} ${safeStringify(meta)}\n`);
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit("debug", message, meta),
  info: (message: string, meta?: unknown) => emit("info", message, meta),
  warn: (message: string, meta?: unknown) => emit("warn", message, meta),
  error: (message: string, meta?: unknown) => emit("error", message, meta),
};
