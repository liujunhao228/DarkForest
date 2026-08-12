#!/usr/bin/env node
/**
 * E2E 测试：双 AI Agent 经 mcpserver 自动匹配互打完整对局。
 *
 * 前置条件（不满足则预检失败，退出码 2）：
 *   1. trust 栈已启动：docker compose -f docker-compose.trust.yml up -d --build
 *      （backend:8080 + postgres + mcpserver:9090，mcpserver 用 AGENT_SEED_NAME
 *      播种 ≥2 个 agent，默认 ai1/ai2）。
 *   2. Agent 管理器已在跑，或本脚本能自拉起（自拉起需 DEEPSEEK_API_KEY）。
 *
 * 流程：
 *   1. 预检 backend / mcpserver / manager 健康；manager 未起则 `node --import
 *      tsx src/index.ts` 拉起并注册清理。
 *   2. POST /api/spawn-agent 依次 spawn 两个子 Agent（默认 ai1/ai2，classic）。
 *   3. 轮询 GET /api/agents/:childId 直到双方进入终态（done/error/cancelled/
 *      terminated）或整体超时（E2E_DUEL_TIMEOUT_MS，默认 30 分钟）。
 *   4. GET /api/metrics 断言：
 *        - 双方都有 match 记录（matches ≥ 1）；
 *        - 至少一方胜利（wins 之和 ≥ 1）；
 *        - 无 stability_incident 类型为 timeout/crash；
 *        - 至少一方创建了 memory（memoryCount 之和 ≥ 1）。
 *   5. 清理：DELETE 两个子 Agent；自拉起的管理器 SIGINT → 3s → 强杀整树。
 *
 * 退出码：0=通过，1=断言/超时失败，2=配置/预检错误。
 *
 * 仅用 Node 内置能力（fetch / child_process / fs），不引入额外依赖。
 * 配置经环境变量或 gameagent/.env 读取（.env 不覆盖已存在的环境变量）。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** GET /api/agents/:childId 返回的子 Agent 状态 */
interface AgentStatus {
  childId: string;
  agentName: string;
  status: string;
  startTime: number;
  currentMatchId: string | null;
  /** 最近活动流水（子 Agent 的 LLM 回合 / 工具执行，可观测性） */
  activity?: Array<{ ts: string; type: string; detail: string }>;
}

/** GET /api/metrics 单条目（http-api.ts handleGetMetrics 扩展后的形状） */
interface MetricsEntry {
  childId: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  timeouts: number;
  crashes: number;
  decisionCount: number;
  totalDecisionTime: number;
  avgDecisionTime: number;
  winRate: number;
  memoryCount: number;
  stabilityIncidents: Array<{ type: string; timestamp: number; details: string }>;
}

/** E2E 运行配置 */
interface E2EConfig {
  gameagentDir: string;
  managerUrl: string;
  managerPort: number;
  backendHealthUrl: string;
  mcpHealthUrl: string;
  gameMode: string;
  agentNames: string[];
  duelTimeoutMs: number;
  pollIntervalMs: number;
  spawnTimeoutMs: number;
  deepseekApiKey: string;
}

// ---------------------------------------------------------------------------
// 常量与配置
// ---------------------------------------------------------------------------

const DEFAULT_MANAGER_PORT = 9091;
const DEFAULT_DUEL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_SPAWN_TIMEOUT_MS = 5 * 60 * 1000;

/** 子 Agent 终态集合（到达任一即视为对局流程结束） */
const TERMINAL_STATUSES = new Set(["done", "error", "cancelled", "terminated"]);

/** 断言不允许出现的 stability_incident 类型 */
const FORBIDDEN_INCIDENTS = new Set(["timeout", "crash"]);

/**
 * 读取 gameagent/.env（若存在）填充未设置的环境变量。
 * 不覆盖 process.env 中已存在的键。
 */
function loadDotEnv(gameagentDir: string): void {
  const envPath = join(gameagentDir, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** 从环境变量组装配置 */
function loadConfig(): E2EConfig {
  const currentFile = fileURLToPath(import.meta.url);
  // <gameagent>/test/e2e-duel.ts → <gameagent>
  const gameagentDir = dirname(dirname(currentFile));
  loadDotEnv(gameagentDir);

  const managerPort = parseInt(process.env.MANAGER_PORT ?? "", 10) || DEFAULT_MANAGER_PORT;
  const mcpUrl = process.env.MCP_URL || "http://localhost:9090/mcp";
  const backendHealthUrl = process.env.BACKEND_HEALTH_URL || "http://127.0.0.1:8080/api/health";
  const mcpHealthUrl = process.env.MCP_HEALTH_URL || `${new URL(mcpUrl).origin}/health`;
  const agentNames = (process.env.E2E_AGENT_NAMES || "ai1,ai2")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    gameagentDir,
    managerUrl: process.env.MANAGER_URL || `http://127.0.0.1:${managerPort}`,
    managerPort,
    backendHealthUrl,
    mcpHealthUrl,
    gameMode: process.env.GAME_MODE || "classic",
    agentNames,
    duelTimeoutMs:
      parseInt(process.env.E2E_DUEL_TIMEOUT_MS ?? "", 10) || DEFAULT_DUEL_TIMEOUT_MS,
    pollIntervalMs:
      parseInt(process.env.E2E_POLL_INTERVAL_MS ?? "", 10) || DEFAULT_POLL_INTERVAL_MS,
    spawnTimeoutMs:
      parseInt(process.env.E2E_SPAWN_TIMEOUT_MS ?? "", 10) || DEFAULT_SPAWN_TIMEOUT_MS,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  };
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 生成带超时的 AbortSignal（避免依赖 lib.dom 的 AbortSignal.timeout） */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return controller.signal;
}

/** GET 并解析 JSON；非 2xx 抛错。超时由调用方传入 signal 控制。 */
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${url} → HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** POST JSON 并解析响应；非 2xx 抛错。 */
async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url} → HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** 在 /api/agents 中按 agentName 查找仍在处理中的子 Agent（用于幂等重试）。 */
async function findExistingChild(managerUrl: string, agentName: string): Promise<string | null> {
  try {
    const agents = await fetchJson<Array<{ childId: string; agentName: string; status: string }>>(
      `${managerUrl}/api/agents`,
      timeoutSignal(5000),
    );
    const match = agents.find(
      (a) =>
        a.agentName === agentName &&
        a.status !== "done" &&
        a.status !== "terminated" &&
        a.status !== "cancelled",
    );
    return match?.childId ?? null;
  } catch {
    return null;
  }
}

/** 删除指定 agentName 的全部子 Agent（失败路径清理）。 */
async function deleteAgentsByName(managerUrl: string, agentNames: string[]): Promise<void> {
  try {
    const agents = await fetchJson<Array<{ childId: string; agentName: string }>>(
      `${managerUrl}/api/agents`,
      timeoutSignal(5000),
    );
    const targets = agents.filter((a) => agentNames.includes(a.agentName)).map((a) => a.childId);
    await Promise.allSettled(
      targets.map((childId) =>
        fetch(`${managerUrl}/api/agents/${childId}`, { method: "DELETE" }).catch(() => undefined),
      ),
    );
  } catch {
    // 忽略读取失败
  }
}

/** 健康检查：<500 即视为就绪（与 trust harness waitHealth 同语义）。 */
async function healthOk(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: timeoutSignal(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** 等待 health 就绪，超时返回 false。 */
async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk(url, 2000)) return true;
    await sleep(1000);
  }
  return false;
}

/** 自拉起的管理器句柄 */
interface ManagedManager {
  child: ChildProcess;
  stdoutTail: string;
  stderrTail: string;
}

// ---------------------------------------------------------------------------
// 管理器自拉起 / 清理
// ---------------------------------------------------------------------------

/** 用 `node --import tsx src/index.ts` 拉起 Agent 管理器，等健康后返回句柄。 */
function spawnManager(config: E2EConfig): ManagedManager {
  const manager: ManagedManager = {
    child: spawn(
      process.execPath,
      ["--import", "tsx", "src/index.ts"],
      {
        cwd: config.gameagentDir,
        env: {
          ...process.env,
          MANAGER_PORT: String(config.managerPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
      },
    ),
    stdoutTail: "",
    stderrTail: "",
  };

  const prefix = `[manager:${manager.child.pid ?? "?"}]`;
  manager.child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    manager.stdoutTail = (manager.stdoutTail + text).slice(-8000);
    process.stdout.write(`${prefix} ${text}`);
  });
  manager.child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    manager.stderrTail = (manager.stderrTail + text).slice(-8000);
    process.stderr.write(`${prefix} ${text}`);
  });
  manager.child.on("exit", (code, signal) => {
    process.stderr.write(`${prefix} 退出 code=${code} signal=${signal}\n`);
  });

  return manager;
}

/** 终止自拉起的管理器：SIGINT → 3s → 整树强杀（Windows 用 taskkill /T /F）。 */
async function killManager(manager: ManagedManager): Promise<void> {
  const child = manager.child;
  if (!child.pid) return;
  if (child.exitCode !== null) return;

  child.kill("SIGINT");
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (exited) return;

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // 进程可能已退出
    }
  }
}

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

/** 从 GET /api/metrics 结果中取指定 childId 的指标条目。 */
function findMetrics(entries: MetricsEntry[], childId: string): MetricsEntry | undefined {
  return entries.find((e) => e.childId === childId);
}

/** 校验断言；返回错误信息数组（空数组 = 通过）。 */
function runAssertions(
  childA: string,
  childB: string,
  metrics: MetricsEntry[],
): string[] {
  const failures: string[] = [];
  const mA = findMetrics(metrics, childA);
  const mB = findMetrics(metrics, childB);

  if (!mA) failures.push(`子 Agent ${childA} 无 metrics 记录`);
  if (!mB) failures.push(`子 Agent ${childB} 无 metrics 记录`);
  if (!mA || !mB) return failures;

  if (mA.matches < 1 || mB.matches < 1) {
    failures.push(`双方都应有 match 记录：A.matches=${mA.matches} B.matches=${mB.matches}`);
  }
  if (mA.wins + mB.wins < 1) {
    failures.push(`至少一方应胜利：A.wins=${mA.wins} B.wins=${mB.wins}`);
  }
  if (mA.memoryCount + mB.memoryCount < 1) {
    failures.push(
      `至少一方应创建 memory：A.memoryCount=${mA.memoryCount} B.memoryCount=${mB.memoryCount}`,
    );
  }
  for (const [label, m] of [
    ["A", mA],
    ["B", mB],
  ] as const) {
    for (const incident of m.stabilityIncidents) {
      if (FORBIDDEN_INCIDENTS.has(incident.type)) {
        failures.push(
          `Agent ${label} 出现禁止的 stability_incident type=${incident.type}: ${incident.details}`,
        );
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const config = loadConfig();

  // ---- 1. 预检 ----
  console.log("=== E2E 双 AI Agent 对局：预检 ===");
  const startedAt = Date.now();

  const backendOk = await waitForHealth(config.backendHealthUrl, 15_000);
  if (!backendOk) {
    console.error(
      `✗ backend 未就绪：${config.backendHealthUrl}\n` +
        "  请先启动 trust 栈：docker compose -f docker-compose.trust.yml up -d --build",
    );
    return 2;
  }
  console.log(`✓ backend 就绪（${config.backendHealthUrl}）`);

  const mcpOk = await waitForHealth(config.mcpHealthUrl, 15_000);
  if (!mcpOk) {
    console.error(
      `✗ mcpserver 未就绪：${config.mcpHealthUrl}\n` +
        "  请确认 trust 栈已启动，且 AGENT_SEED_NAME 播种了 ≥2 个 agent",
    );
    return 2;
  }
  console.log(`✓ mcpserver 就绪（${config.mcpHealthUrl}）`);

  const managerOk = await healthOk(`${config.managerUrl}/health`, 5000);
  let managed: ManagedManager | null = null;
  if (managerOk) {
    console.log(`✓ 复用已运行的管理器（${config.managerUrl}）`);
  } else {
    if (!config.deepseekApiKey) {
      console.error(
        "✗ Agent 管理器未运行，且缺少 DEEPSEEK_API_KEY（自拉起需要）。\n" +
          "  请先启动管理器，或设置 DEEPSEEK_API_KEY / 配置 gameagent/.env",
      );
      return 2;
    }
    console.log(`✗ 管理器未运行，尝试自拉起（${config.managerUrl}）…`);
    managed = spawnManager(config);
    const up = await waitForHealth(`${config.managerUrl}/health`, 60_000);
    if (!up) {
      console.error(
        "✗ 管理器自拉起超时。最近输出：\n" +
          (managed.stdoutTail || managed.stderrTail || "（无输出）"),
      );
      await killManager(managed);
      return 2;
    }
    console.log("✓ 管理器已就绪");
  }

  // ---- 2. spawn 两个子 Agent ----
  console.log("=== spawn 子 Agent ===");
  const childIds: string[] = [];
  for (const agentName of config.agentNames) {
    let childId = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      // 上一次请求可能已在服务端生效（客户端超时/连接被中断），直接复用，避免重复 spawn
      if (attempt > 1) {
        const existing = await findExistingChild(config.managerUrl, agentName);
        if (existing) {
          console.warn(`spawn ${agentName}：检测到上次请求已创建 ${existing}，复用`);
          childId = existing;
          break;
        }
      }
      try {
        const resp = await postJson<{ childId: string }>(
          `${config.managerUrl}/api/spawn-agent`,
          { agentName, gameMode: config.gameMode },
          timeoutSignal(config.spawnTimeoutMs),
        );
        if (!resp.childId) throw new Error("响应缺少 childId");
        childId = resp.childId;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`spawn ${agentName} 第 ${attempt} 次失败：${msg}`);
        if (attempt === 2) {
          console.error(`✗ 两次 spawn ${agentName} 均失败，清理已创建的子 Agent…`);
          await deleteAgentsByName(config.managerUrl, config.agentNames);
          if (managed) await killManager(managed);
          return 1;
        }
        await sleep(3000);
      }
    }
    childIds.push(childId);
    console.log(`✓ 已 spawn ${agentName} → childId=${childId}`);
  }

  const [childA, childB] = childIds;
  if (!childA || !childB) {
    console.error("✗ 未拿到两个子 Agent 的 childId");
    if (managed) await killManager(managed);
    return 1;
  }

  // ---- 3. 轮询直到双方终态 / 超时 ----
  console.log("=== 等待对局结束 ===");
  const deadline = Date.now() + config.duelTimeoutMs;
  let lastLogAt = 0;
  const finalStatuses: AgentStatus[] = [];

  while (Date.now() < deadline) {
    const statuses: AgentStatus[] = [];
    let ok = true;
    for (const childId of [childA, childB]) {
      try {
        const status = await fetchJson<AgentStatus>(
          `${config.managerUrl}/api/agents/${childId}`,
          timeoutSignal(10_000),
        );
        statuses.push(status);
      } catch {
        ok = false;
        break;
      }
    }
    if (!ok) {
      console.warn("读取子 Agent 状态失败，稍后重试…");
      await sleep(config.pollIntervalMs);
      continue;
    }

    const terminal = statuses.every((s) => TERMINAL_STATUSES.has(s.status));
    if (Date.now() - lastLogAt > 15_000 || terminal) {
      lastLogAt = Date.now();
      for (const s of statuses) {
        console.log(
          `  [${s.agentName}] status=${s.status} matchId=${s.currentMatchId ?? "-"}`,
        );
      }
    }

    if (terminal) {
      finalStatuses.push(...statuses);
      break;
    }
    await sleep(config.pollIntervalMs);
  }

  if (finalStatuses.length === 0) {
    console.error(
      `✗ 等待对局结束超时（${config.duelTimeoutMs}ms）。` +
        "请确认 mcpserver 播种名单包含所 spawn 的 agent，且 LLM 决策正常。",
    );
    for (const childId of [childA, childB]) {
      try {
        const s = await fetchJson<AgentStatus>(
          `${config.managerUrl}/api/agents/${childId}`,
          timeoutSignal(10_000),
        );
        console.log(`  [${s.agentName}] status=${s.status} matchId=${s.currentMatchId ?? "-"}`);
        // 卡点诊断：打印最近活动流水尾部
        const recent = (s.activity ?? []).slice(-8);
        if (recent.length > 0) {
          console.log(`  [${s.agentName}] 最近活动:`);
          for (const a of recent) {
            console.log(`    ${a.ts} ${a.type}: ${a.detail.slice(0, 200)}`);
          }
        } else {
          console.log(`  [${s.agentName}] （无活动流水）`);
        }
      } catch {
        // 忽略读取失败
      }
    }
    for (const childId of [childA, childB]) {
      await fetch(`${config.managerUrl}/api/agents/${childId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
    if (managed) await killManager(managed);
    return 1;
  }

  // ---- 4. 采集指标并断言 ----
  console.log("=== 断言 ===");
  let metrics: MetricsEntry[];
  try {
    metrics = await fetchJson<MetricsEntry[]>(
      `${config.managerUrl}/api/metrics`,
      timeoutSignal(15_000),
    );
  } catch (err) {
    console.error(`✗ 读取 /api/metrics 失败：${err instanceof Error ? err.message : err}`);
    if (managed) await killManager(managed);
    return 1;
  }

  const failures = runAssertions(childA, childB, metrics);
  const mA = findMetrics(metrics, childA);
  const mB = findMetrics(metrics, childB);
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  console.log(
    `  耗时 ${elapsedSec}s\n` +
      `  A ${childA}: matches=${mA?.matches ?? "-"} wins=${mA?.wins ?? "-"} ` +
      `losses=${mA?.losses ?? "-"} memoryCount=${mA?.memoryCount ?? "-"} ` +
      `incidents=${mA?.stabilityIncidents.length ?? "-"}\n` +
      `  B ${childB}: matches=${mB?.matches ?? "-"} wins=${mB?.wins ?? "-"} ` +
      `losses=${mB?.losses ?? "-"} memoryCount=${mB?.memoryCount ?? "-"} ` +
      `incidents=${mB?.stabilityIncidents.length ?? "-"}`,
  );

  for (const childId of [childA, childB]) {
    await fetch(`${config.managerUrl}/api/agents/${childId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }
  if (managed) await killManager(managed);

  if (failures.length > 0) {
    console.error("✗ E2E 断言失败：");
    for (const f of failures) console.error(`  - ${f}`);
    // 诊断：打印双方最近活动流水尾部，帮助定位是没匹配上 / 没上报 / 卡在哪一步
    for (const childId of [childA, childB]) {
      try {
        const s = await fetchJson<AgentStatus>(
          `${config.managerUrl}/api/agents/${childId}`,
          timeoutSignal(10_000),
        );
        const recent = (s.activity ?? []).slice(-6);
        console.log(`  [${s.agentName}] 最近活动（status=${s.status}）:`);
        for (const a of recent) {
          console.log(`    ${a.ts} ${a.type}: ${a.detail.slice(0, 160)}`);
        }
      } catch {
        // 忽略读取失败
      }
    }
    return 1;
  }

  console.log("✓ E2E 双 AI Agent 对局通过");
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
