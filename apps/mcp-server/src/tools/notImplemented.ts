import { ToolError } from "../errors";

/** Shared placeholder: the contract is real, the behaviour is not built yet. */
export function notImplemented(tool: string): never {
  throw new ToolError(
    "not_implemented",
    `Tool "${tool}" has a defined contract but is not implemented in this scaffold yet.`,
  );
}
