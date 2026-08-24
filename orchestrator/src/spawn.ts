/**
 * dsh agent 进程 spawn。
 *
 * 真实实现：用 `child_process.spawn` 拉起 headless dsh agent 进程
 * （`node --import tsx/esm apps/cli/src/bin.ts --profile <profile> <task>`，
 * 即根 `pnpm dsh` 的等价源码启动），注入 DF_AGENT_SID。
 *
 * 不用 shell：Windows 下 shell:true 走 cmd/ps1，会按系统代码页（GBK）重编码
 * argv，把中文 task 打成乱码。免 shell 后 Node 经 CreateProcessW 以 UTF-16
 * 传参，中文 task 原样到达子进程。
 *
 * @module
 */

import { resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

/** dsh 源码入口相对 dshRoot 的路径（apps/cli owns the `dsh` bin）。 */
const DSH_SOURCE_ENTRY = 'apps/cli/src/bin.ts'

/** spawn 一个 dsh agent 所需的参数。 */
export interface SpawnDshOptions {
  /** 进程唯一标识，注入子进程 env 的 DF_AGENT_SID（须来自已播种 sid 池）。 */
  sid: string
  /** dsh 仓库根（spawn 的 cwd）。 */
  dshRoot: string
  /** 拉起 agent 使用的 dsh profile。 */
  profile: string
  /** 交给 agent 的任务文本。 */
  task: string
}

/** 可测试性覆写：可执行文件与参数（测试注入无害命令以保持夹具封闭）。 */
export interface SpawnDshOverrides {
  command?: string
  args?: string[]
}

/**
 * 组装默认 dsh 启动 argv：`--import tsx/esm <dshRoot>/apps/cli/src/bin.ts --profile <profile> <task>`。
 * 这是根 `pnpm dsh` 的等价命令；单测用它直接钉住「中文 task 原样进入 argv」这条修复。
 */
export function defaultDshArgs(opts: SpawnDshOptions): string[] {
  return [
    '--import',
    'tsx/esm',
    resolve(opts.dshRoot, DSH_SOURCE_ENTRY),
    '--profile',
    opts.profile,
    opts.task,
  ]
}

/**
 * 用 child_process.spawn 起一个 headless dsh agent 进程。
 * 默认以 node + tsx 直拉 dsh 源码入口，不经 shell，规避 Windows 代码页重编码。
 */
export function spawnDshAgent(opts: SpawnDshOptions & SpawnDshOverrides): ChildProcess {
  const command = opts.command ?? process.execPath
  const args = opts.args ?? defaultDshArgs(opts)
  return spawn(command, args, {
    cwd: opts.dshRoot,
    env: { ...process.env, DF_AGENT_SID: opts.sid },
    shell: false,
  })
}
