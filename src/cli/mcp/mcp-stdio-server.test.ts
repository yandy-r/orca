import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function orcaMcpLaunch(): {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
} {
  const manifest = createRequire(resolve('package.json')).resolve('bun/package.json')
  const { bin } = z
    .object({ bin: z.object({ bun: z.string() }) })
    .parse(JSON.parse(readFileSync(manifest, 'utf8')))
  const root = mkdtempSync(join(tmpdir(), 'orca-mcp-stdio-'))
  roots.push(root)
  // An empty profile has no runtime, so `status` answers without touching the developer's Orca.
  const env = {
    ...Object.fromEntries(
      'HOME USERPROFILE APPDATA LOCALAPPDATA XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME ORCA_USER_DATA_PATH TEMP TMP TMPDIR'
        .split(' ')
        .map((key) => [key, root])
    ),
    ORCA_BACKGROUND_LAUNCH: '1',
    PATH: process.env.PATH ?? '',
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {})
  }
  return {
    command: join(dirname(manifest), bin.bun),
    args: [resolve('src/cli/index.ts'), 'mcp'],
    cwd: root,
    env
  }
}

// Boots the CLI from source twice (server plus the status child), which is slow on Windows runners.
it('an MCP client lists tools and calls status over stdio', async () => {
  const transport = new StdioClientTransport({ ...orcaMcpLaunch(), stderr: 'pipe' })
  const client = new Client({ name: 'orca-mcp-test', version: '0.0.0' })
  await client.connect(transport)
  try {
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toContain('status')

    const result = await client.callTool({ name: 'status', arguments: {} })
    expect(result.isError ?? false).toBe(false)
    expect(result.structuredContent).toMatchObject({
      app: { running: false },
      runtime: { reachable: false }
    })
  } finally {
    await client.close()
  }
}, 60_000)

// SDK clients skip unparseable lines, so read raw stdout to catch anything that is not a protocol frame.
// Boots the CLI from source twice (server plus the status child), which is slow on Windows runners.
it('writes only JSON-RPC messages to stdout and exits when stdin closes', async () => {
  const { command, args, cwd, env } = orcaMcpLaunch()
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  const exited = new Promise<number | null>((done) => child.once('close', done))
  const statusAnswered = new Promise<void>((done, fail) => {
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (
        stdout
          .split('\n')
          .some((line) => line.startsWith('{') && line.endsWith('}') && JSON.parse(line).id === 2)
      ) {
        done()
      }
    })
    void exited.then(() => fail(new Error(`orca mcp exited early: ${stderr}`)))
  })
  const send = (message: {
    id?: number
    method: string
    params?: Record<string, unknown>
  }): void => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }
  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'orca-mcp-test', version: '0.0.0' }
      }
    })
    send({ method: 'notifications/initialized' })
    send({ id: 2, method: 'tools/call', params: { name: 'status', arguments: {} } })
    await statusAnswered
    child.stdin.end()
    expect(await exited, stderr).toBe(0)
  } finally {
    child.kill()
  }

  const lines = stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    expect(
      () => z.object({ jsonrpc: z.literal('2.0') }).parse(JSON.parse(line)),
      line
    ).not.toThrow()
  }
  expect(lines.map((line) => JSON.parse(line).id)).toEqual([1, 2])
}, 60_000)
