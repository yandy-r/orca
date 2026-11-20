import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

export const MCP_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mcp'],
    summary: "Run an MCP server over stdio that exposes Orca's operations as tools",
    usage: 'orca mcp',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Speaks the Model Context Protocol on stdin/stdout and exits when stdin closes. Point an MCP client at the command `orca mcp`.',
      'Diagnostics go to stderr; stdout carries only protocol messages.'
    ],
    examples: ['orca mcp']
  }
]
