/**
 * Minimal leveled logger. Writes to stderr so it never pollutes any future stdio transport.
 * Do not log API keys, note contents, student answers or whole student records.
 */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(min: Level) {
  const emit = (level: Level, message: string, meta?: Record<string, unknown>) => {
    if (order[level] < order[min]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, message, ...meta });
    process.stderr.write(line + "\n");
  };
  return {
    debug: (m: string, meta?: Record<string, unknown>) => emit("debug", m, meta),
    info: (m: string, meta?: Record<string, unknown>) => emit("info", m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => emit("warn", m, meta),
    error: (m: string, meta?: Record<string, unknown>) => emit("error", m, meta),
  };
}
export type Logger = ReturnType<typeof createLogger>;
