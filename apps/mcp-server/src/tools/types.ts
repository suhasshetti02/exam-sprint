import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ToolDefinition<TInput extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  name: string;
  /** "planned" = contract only; "implemented" = real behaviour with tests. */
  status: "planned" | "implemented";
  config: {
    title: string;
    description: string;
    inputSchema: TInput;
    outputSchema: z.ZodTypeAny;
    annotations: ToolAnnotations;
  };
  handler: (input: z.infer<TInput>) => Promise<CallToolResult>;
}
