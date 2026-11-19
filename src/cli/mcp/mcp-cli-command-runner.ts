import { statSync } from 'node:fs'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { runProcess } from '@orca/process-host'
import { getPackagedElectronExecutable } from '../runtime/app-launch/packaged-cli-interpreter'

export const MCP_CLI_COMMAND_TIMEOUT_MS = 60_000
const MAX_CLI_OUTPUT_BYTES = 4 * 1024 * 1024
const MAX_CONCURRENT_CLI_COMMANDS = 4

export type McpCliCommand = {
  /** CLI path words and flags, without `--json`. */
  args: readonly string[]
  cwd: string
  signal: AbortSignal
  timeoutMs?: number
}

type CliInvocation = { command: string; args: string[]; env: NodeJS.ProcessEnv }

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// A child inheriting --inspect would fight the server for the debugger port.
function childExecArgv(execArgv: readonly string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < execArgv.length; index++) {
    const arg = execArgv[index]
    if (arg === '--inspect-port' || arg === '--debug-port') {
      index++
    } else if (!arg.startsWith('--inspect') && !arg.startsWith('--debug-port')) {
      kept.push(arg)
    }
  }
  return kept
}

// Relaunch the entry that started this server so tools behave like `orca … --json`, built or from source.
export function currentOrcaCliInvocation(): CliInvocation {
  const entry = process.argv[1]
  const evaluated = process.execArgv.some((arg) => ['-e', '--eval', '-p', '--print'].includes(arg))
  if (!entry || evaluated || !isFile(entry)) {
    throw new Error('orca mcp must run from the orca CLI entry file; reinstall the orca command')
  }
  const electron = getPackagedElectronExecutable()
  return {
    command: process.execPath,
    args: [...childExecArgv(process.execArgv), entry],
    // The CLI consumes this at startup, so restore it for app-owned commands in the child.
    env: electron ? { ...process.env, ORCA_CLI_ELECTRON_EXECUTABLE: electron } : process.env
  }
}

function errorResult(message: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    ...(structured ? { structuredContent: structured } : {})
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function cliJsonToToolResult(
  stdout: string,
  stderr: string,
  exitCode: number | null
): CallToolResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    const detail = stderr.trim() || stdout.trim() || `exit code ${exitCode ?? 'unknown'}`
    return errorResult(`orca CLI returned no JSON result: ${detail.slice(-2_000)}`)
  }
  if (isRecord(parsed) && parsed.ok === true) {
    const result = parsed.result
    return {
      content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
      ...(isRecord(result) ? { structuredContent: result } : {})
    }
  }
  if (isRecord(parsed) && parsed.ok === false && isRecord(parsed.error)) {
    const { code, message } = parsed.error
    return errorResult(
      `${String(code ?? 'runtime_error')}: ${String(message ?? 'Unknown error')}`,
      {
        error: parsed.error
      }
    )
  }
  return errorResult('orca CLI returned an unrecognized JSON result')
}

let activeCommands = 0
const waitingCommands: (() => void)[] = []

async function withCommandSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeCommands >= MAX_CONCURRENT_CLI_COMMANDS) {
    await new Promise<void>((acquire) => waitingCommands.push(acquire))
  } else {
    activeCommands++
  }
  try {
    return await run()
  } finally {
    const next = waitingCommands.shift()
    if (next) {
      next()
    } else {
      activeCommands--
    }
  }
}

async function spawnCliCommand(
  command: McpCliCommand,
  invocation: CliInvocation
): Promise<CallToolResult> {
  const timeoutMs = command.timeoutMs ?? MCP_CLI_COMMAND_TIMEOUT_MS
  if (command.signal.aborted) {
    return errorResult('cancelled')
  }
  if (!isDirectory(command.cwd)) {
    return errorResult(`Working directory does not exist: ${command.cwd}`)
  }
  let result: Awaited<ReturnType<typeof runProcess>>
  try {
    // stdin stays closed: the parent's stdin is the MCP stream.
    result = await runProcess({
      program: invocation.command,
      args: [...invocation.args, ...command.args, '--json'],
      cwd: command.cwd,
      env: invocation.env,
      timeoutMs,
      signal: command.signal,
      maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
      killOnOutputLimit: true
    })
  } catch (error) {
    return errorResult(
      `orca CLI failed to start: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (command.signal.aborted) {
    return errorResult('cancelled')
  }
  if (result.timedOut) {
    return errorResult(`orca ${command.args[0] ?? ''} timed out after ${timeoutMs}ms`)
  }
  if (result.outputTruncated) {
    return errorResult(`orca CLI output exceeded ${MAX_CLI_OUTPUT_BYTES} bytes`)
  }
  return cliJsonToToolResult(result.stdout, result.stderr, result.code)
}

/** Runs one CLI command in a child so handler console writes and exit codes never touch the MCP stdio stream. */
export function runOrcaCliCommand(
  command: McpCliCommand,
  invocation?: CliInvocation
): Promise<CallToolResult> {
  let resolved: CliInvocation
  try {
    resolved = invocation ?? currentOrcaCliInvocation()
  } catch (error) {
    return Promise.resolve(errorResult(error instanceof Error ? error.message : String(error)))
  }
  return withCommandSlot(() => spawnCliCommand(command, resolved))
}
