import { z } from "zod";

const schema = z.object({
  MCP_SERVER_URL: z.string().url().default("http://127.0.0.1:3001/mcp"),
});

/** Server-side settings, read from the environment on each call (never exposed to the browser). */
export function getServerConfig(env: NodeJS.ProcessEnv = process.env) {
  return schema.parse(env);
}
