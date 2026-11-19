import type { McpToolDefinition } from './mcp-tool-registry'
import { STATUS_MCP_TOOL } from './tools/status-mcp-tool'

/** One entry per capability id; capability issues append here. */
export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [STATUS_MCP_TOOL]
