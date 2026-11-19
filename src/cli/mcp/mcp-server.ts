import { McpServer } from '@modelcontextprotocol/server'
import { readOrcaCliVersion } from '../cli-version'
import type { McpServerContext, RegisteredMcpTool } from './mcp-tool-registry'

export const ORCA_MCP_SERVER_NAME = 'orca'

export function createOrcaMcpServer(
  tools: readonly RegisteredMcpTool[],
  ctx: McpServerContext
): McpServer {
  const server = new McpServer(
    { name: ORCA_MCP_SERVER_NAME, version: readOrcaCliVersion() ?? '0.0.0' },
    // Advertise tools even while the registry is empty so clients can rely on tools/list.
    { capabilities: { tools: { listChanged: false } } }
  )
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      },
      (input, request) => tool.run(input, { ...ctx, signal: request.mcpReq.signal })
    )
  }
  return server
}
