import { createApp, HEALTH_PATH, MCP_PATH } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const app = createApp(logger);

// Bind to loopback by default: this scaffold has no authentication.
const server = app.listen(config.MCP_PORT, config.MCP_HOST, () => {
  logger.info("exam-sprint MCP server listening", {
    mcp: `http://${config.MCP_HOST}:${config.MCP_PORT}${MCP_PATH}`,
    health: `http://${config.MCP_HOST}:${config.MCP_PORT}${HEALTH_PATH}`,
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
