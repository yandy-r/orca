import { serveStdio } from '@modelcontextprotocol/server/stdio'
import type { CommandHandler } from '../dispatch/dispatch'
import { createOrcaMcpServer } from './mcp-server'
import { resolveMcpTools } from './mcp-tool-registry'

const runMcpServer: CommandHandler = async ({ cwd }) => {
  // Resolve once so a bad registry fails at startup instead of on the first request.
  const tools = resolveMcpTools()
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      void handle.close().finally(() => (error ? reject(error) : resolve()))
    }
    // stdout carries the protocol, so diagnostics go to stderr.
    const handle = serveStdio(() => createOrcaMcpServer(tools, { cwd }), {
      onerror: (error) => process.stderr.write(`orca mcp: ${error.message}\n`)
    })
    process.stdin.once('end', () => finish())
    process.stdin.once('error', (error) => finish(error))
  })
}

export const MCP_HANDLERS: Record<string, CommandHandler> = {
  mcp: runMcpServer
}
