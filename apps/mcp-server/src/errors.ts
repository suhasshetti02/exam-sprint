import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Errors a tool handler may throw deliberately. Message text is safe to show to the model. */
export class ToolError extends Error {
  constructor(
    public readonly code: "not_implemented" | "not_found" | "invalid_state" | "internal",
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Tool *execution* failures are returned as `isError: true` results so the calling model can
 * read and react to them. Protocol-level problems (unknown tool, malformed JSON-RPC, and
 * input that fails the declared schema) are reported by the SDK as JSON-RPC errors.
 */
export function toolErrorResult(error: unknown): CallToolResult {
  if (error instanceof ToolError) {
    return { isError: true, content: [{ type: "text", text: `${error.code}: ${error.message}` }] };
  }
  return { isError: true, content: [{ type: "text", text: "internal: the tool failed unexpectedly." }] };
}
