import { expect, it } from 'vitest'
import { runOrcaCliCommand } from './mcp-cli-command-runner'

// Budget covers process-tree termination after the 200ms deadline.
it('settles a timed-out command even while a grandchild holds its output pipes', async () => {
  const holdPipes = `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'inherit' }); setTimeout(() => {}, 8000)`
  const result = await runOrcaCliCommand(
    { args: ['status'], cwd: process.cwd(), signal: new AbortController().signal, timeoutMs: 200 },
    { command: process.execPath, args: ['-e', holdPipes, '--'], env: process.env }
  )
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: 'text', text: 'orca status timed out after 200ms' }]
  })
}, 15_000)
