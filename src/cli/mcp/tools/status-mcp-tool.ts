import { z } from 'zod'
import { runOrcaCliCommand } from '../mcp-cli-command-runner'
import { defineMcpTool } from '../mcp-tool-registry'

export const STATUS_MCP_TOOL = defineMcpTool({
  capabilityId: 'status',
  title: 'Orca status',
  description:
    'Show whether the Orca app, runtime, and graph are ready. Returns caller.orcaSessionId when this server runs inside an Orca session.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  run: (_input, ctx) => runOrcaCliCommand({ args: ['status'], cwd: ctx.cwd, signal: ctx.signal })
})
