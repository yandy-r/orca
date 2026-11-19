import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server'
import type { z } from 'zod'

export type McpServerContext = {
  cwd: string
}

export type McpToolContext = McpServerContext & {
  /** Aborts when the client cancels the call or the connection closes. */
  signal: AbortSignal
}

export type McpToolDefinition<Input extends z.ZodObject = z.ZodObject> = {
  /** Capability id from the parity inventory, e.g. `repo.list`. */
  capabilityId: string
  title: string
  description: string
  inputSchema: Input
  annotations: ToolAnnotations
  run: (input: z.output<Input>, ctx: McpToolContext) => Promise<CallToolResult>
}

// Erases the input type so differently-shaped tools fit one table; parsing keeps `run` typed without a cast.
export function defineMcpTool<Input extends z.ZodObject>(
  definition: McpToolDefinition<Input>
): McpToolDefinition {
  return {
    ...definition,
    run: (input, ctx) => definition.run(definition.inputSchema.parse(input), ctx)
  }
}

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/

export function mcpToolName(capabilityId: string): string {
  return capabilityId.replaceAll('.', '_')
}

export type RegisteredMcpTool = McpToolDefinition & { name: string }

/** Validates the table and returns it sorted by tool name so `tools/list` order never depends on edit order. */
export function resolveMcpTools(definitions: readonly McpToolDefinition[]): RegisteredMcpTool[] {
  const byName = new Map<string, RegisteredMcpTool>()
  const capabilityIds = new Set<string>()
  for (const definition of definitions) {
    const { capabilityId } = definition
    if (!CAPABILITY_ID_PATTERN.test(capabilityId)) {
      throw new Error(`Invalid MCP capability id "${capabilityId}"`)
    }
    // The server cannot usefully expose itself as a tool.
    if (capabilityId.split('.')[0] === 'mcp') {
      throw new Error(`MCP capability "${capabilityId}" cannot be exposed as a tool`)
    }
    if (capabilityIds.has(capabilityId)) {
      throw new Error(`Duplicate MCP capability id "${capabilityId}"`)
    }
    capabilityIds.add(capabilityId)
    const name = mcpToolName(capabilityId)
    if (byName.has(name)) {
      throw new Error(`MCP tool name "${name}" is produced by more than one capability id`)
    }
    byName.set(name, { ...definition, name })
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}
