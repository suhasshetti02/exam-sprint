import { NextResponse } from "next/server";
import { getServerConfig } from "@/lib/server/config";
import { getMcpStatus } from "@/lib/server/mcp-status";
import { getProviderStatus } from "@/lib/server/llm/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const { MCP_SERVER_URL } = getServerConfig();
  const mcpStatus = await getMcpStatus(MCP_SERVER_URL);
  const providerStatus = getProviderStatus();

  return NextResponse.json({
    ...mcpStatus,
    provider: providerStatus,
  });
}
