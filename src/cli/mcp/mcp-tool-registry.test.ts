import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineMcpTool, resolveMcpTools } from './mcp-tool-registry'

function tool(capabilityId: string) {
  return defineMcpTool({
    capabilityId,
    title: capabilityId,
    description: capabilityId,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    run: async () => ({ content: [] })
  })
}

describe('resolveMcpTools', () => {
  it('names tools from capability ids and orders them by name', () => {
    const tools = resolveMcpTools([tool('worktree.list'), tool('repo.list'), tool('ai-vault.list')])
    expect(tools.map((entry) => entry.name)).toEqual([
      'ai-vault_list',
      'repo_list',
      'worktree_list'
    ])
  })

  it('rejects duplicate capability ids', () => {
    expect(() => resolveMcpTools([tool('repo.list'), tool('repo.list')])).toThrow(
      'Duplicate MCP capability id "repo.list"'
    )
  })

  it('refuses to expose the mcp command itself', () => {
    expect(() => resolveMcpTools([tool('mcp.serve')])).toThrow(
      'MCP capability "mcp.serve" cannot be exposed as a tool'
    )
  })

  it('rejects ids that are not capability ids', () => {
    expect(() => resolveMcpTools([tool('repo_list')])).toThrow(
      'Invalid MCP capability id "repo_list"'
    )
  })
})
