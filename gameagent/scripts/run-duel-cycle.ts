/**
 * 双子 Agent 完整游戏循环脚本（run_cycle 自然结束，不发放 stop）。
 *
 * 流程：
 *   1. 创建 GameAgentManager（复用库代码，不起 HTTP server）
 *   2. spawn 两个子 Agent（agentName = mcpserver 账户池 sid）
 *   3. 等待各自子 session 就绪 → 投递 run_cycle（完整闭环：写/取脚本 →
 *      L1 校验 → 批量对局 → 复盘 → 发布新版本 v_published）
 *   4. **不发放 stop 命令**，轮询等待两个周期自然结束：
 *        - 自然完成：v_published 周期闭环（cycleStartedAt 清空 + driver done）
 *        - 异常结束：driver_failed（driver.status=failed）
 *        - 强制回收：idle/cycle 超时（entry.status=terminated）
 *        - 兜底：--timeout-min 到点未结束 → 打印当前状态收尾，退出码 1
 *   5. 打印汇总（每 Agent 的 driver 状态 / 脚本版本 / 对局指标），dispose
 *
 * 前置条件：
 *   - trust 栈已起：backend + postgres + mcpserver（默认 localhost:9090/mcp）
 *   - mcpserver 已播种 ≥2 个 agent 名（docker-compose.trust.yml 的
 *     AGENT_SEED_NAME，或 add_pool_agent）
 *   - DEEPSEEK_API_KEY 已设置（子 Agent 写脚本/复盘依赖 LLM）
 *
 * 运行（gameagent/ 目录下）：
 *   DEEPSEEK_API_KEY=xxx npx tsx scripts/run-duel-cycle.ts \
 *     --agents "ai1:Alpha,ai2:Beta" --game-mode classic --games 3 --review-every 3
 *
 * CLI 参数（均可省略，默认见下）：
 *   --agents "ai1:Alpha,ai2:Beta"  两个子 Agent（逗号分隔 sid 或 sid:昵称，
 *                                  默认取 AGENT_SEED_NAMES 前两个）
 *   --game-mode classic            对局模式（classic | civilization_relics）
 *   --games 3                      run_cycle 批量局数（默认 3）
 *   --review-every 3               复盘频率（默认同 games，即批次结束后复盘并发布一轮）
 *   --timeout-min 120              总等待超时（分钟，默认 120；到点未自然结束则收尾退出 1）
 *   --poll-ms 5000                 状态轮询间隔（毫秒，默认 5000）
 *   --script-prefix duel           脚本名前缀（每个 Agent 用 <prefix>-<sid> 作为 script_name）
 */

import process from "node:process";
import { loadConfig, type AppConfig } from "../src/config.js";
import { GameAgentManager } from "../src/manager.js";

// ---------------------------------------------------------------------------
// 类型与工具
// ---------------------------------------------------------------------------

/** CLI 解析结果 */
interface CliArgs {
  agents: string;
  gameMode: string;
  games: number;
  reviewEvery: number;
  timeoutMin: number;
  pollMs: number;
  scriptPrefix: string;
}

/** Agent 规格（sid 即 mcpserver 账户池标识） */
interface AgentSpec {
  sid: string;
  nickname: string;
}

/** 被跟踪的子 Agent 阶段 */
type TrackedPhase = "waiting_ready" | "running" | "done" | "failed" | "terminated";

interface TrackedAgent {
  childId: string;
  sid: string;
  scriptName: string;
  phase: TrackedPhase;
  dispatchFailures: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 手工解析 CLI 参数（不引入依赖） */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    agents: "",
    gameMode: "classic",
    games: 3,
    reviewEvery: 0,
    timeoutMin: 120,
    pollMs: 5000,
    scriptPrefix: "duel",
  };
  const readValue = (flag: string): string => {
    const value = argv.shift();
    if (value === undefined) throw new Error(`缺少 ${flag} 的值`);
    return value;
  };
  while (argv.length > 0) {
    const flag = argv.shift();
    switch (flag) {
      case "--agents":
        args.agents = readValue(flag);
        break;
      case "--game-mode":
        args.gameMode = readValue(flag);
        break;
      case "--games":
        args.games = parseInt(readValue(flag), 10);
        break;
      case "--review-every":
        args.reviewEvery = parseInt(readValue(flag), 10);
        break;
      case "--timeout-min":
        args.timeoutMin = parseInt(readValue(flag), 10);
        break;
      case "--poll-ms":
        args.pollMs = parseInt(readValue(flag), 10);
        break;
      case "--script-prefix":
        args.scriptPrefix = readValue(flag);
        break;
      default:
        throw new Error(`未知参数: ${flag}`);
    }
  }
  if (!Number.isInteger(args.games) || args.games < 1) throw new Error("--games 必须是 ≥1 的整数");
  if (args.reviewEvery !== 0 && (!Number.isInteger(args.reviewEvery) || args.reviewEvery < 1)) {
    throw new Error("--review-every 必须是 ≥1 的整数");
  }
  if (!Number.isInteger(args.timeoutMin) || args.timeoutMin < 1) throw new Error("--timeout-min 必须是 ≥1 的整数");
  if (!Number.isInteger(args.pollMs) || args.pollMs < 500) throw new Error("--poll-ms 必须是 ≥500 的整数");
  return args;
}

/** 解析 agent 名单：优先 CLI --agents，否则取配置 AGENT_SEED_NAMES 前两个 */
function resolveAgents(raw: string, config: AppConfig): AgentSpec[] {
  if (raw.trim()) {
    return raw
      .split(",")
      .map((s) => {
        const t = s.trim();
        const i = t.indexOf(":");
        return i === -1
          ? { sid: t, nickname: t }
          : { sid: t.slice(0, i), nickname: t.slice(i + 1) || t.slice(0, i) };
      })
      .filter((a) => a.sid !== "");
  }
  return config.agentSeedNames.slice(0, 2).map((e) => ({ sid: e.sid, nickname: e.nickname || e.sid }));
}

/** 打印单个子 Agent 当前摘要 */
function summarize(t: TrackedAgent, entry: NonNullable<ReturnType<GameAgentManager["getAgent"]>>): string {
  const m = entry.metrics;
  return [
    `agent=${t.sid}`,
    `child=${t.childId.slice(0, 20)}`,
    `phase=${t.phase}`,
    `driver=${entry.driver.status}`,
    `script=${entry.driver.scriptName ?? "-"}`,
    `v=${entry.driver.scriptVersion ?? "-"}`,
    `batch=${entry.driver.batchMatches}局`,
    `w/l/d=${entry.driver.batchWins}/${entry.driver.batchLosses}/${entry.driver.batchDraws}`,
    `matches=${m.matches}`,
    `wins=${m.wins}`,
    `losses=${m.losses}`,
    `draws=${m.draws}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  if (!config.deepseekApiKey) {
    console.error("[run-duel-cycle] 缺少 DEEPSEEK_API_KEY：子 Agent 写脚本/复盘依赖 LLM，必须设置后重试。");
    return 2;
  }

  const specs = resolveAgents(args.agents, config);
  if (specs.length < 2) {
    console.error(
      `[run-duel-cycle] 需要 ≥2 个子 Agent（当前 ${specs.length}）。` +
        `请用 --agents "sid1,sid2" 指定，或播种 AGENT_SEED_NAMES（默认 ai1:AgentAlpha,ai2:AgentBeta）。`,
    );
    return 2;
  }
  const [a0, a1] = specs;
  const reviewEvery = args.reviewEvery || args.games;

  console.log(
    `[run-duel-cycle] 创建 GameAgentManager model=${config.modelProvider}/${config.modelId} mcp=${config.mcpUrl} …`,
  );
  const manager = await GameAgentManager.create(config);
  const tracked: TrackedAgent[] = [];

  try {
    // 1. spawn 两个子 Agent
    for (const spec of [a0, a1]) {
      const childId = await manager.spawnAgent(spec.sid, args.gameMode);
      tracked.push({
        childId,
        sid: spec.sid,
        scriptName: `${args.scriptPrefix}-${spec.sid}`,
        phase: "waiting_ready",
        dispatchFailures: 0,
      });
      console.log(
        `[run-duel-cycle] 已 spawn childId=${childId} agent=${spec.sid} gameMode=${args.gameMode}`,
      );
    }

    // 2. 等待子 session 就绪 → 投递 run_cycle（全程不投 stop）
    for (const t of tracked) {
      const readyDeadline = Date.now() + 5 * 60_000;
      let entry = manager.getAgent(t.childId);
      while (!entry?.session && Date.now() < readyDeadline) {
        await sleep(args.pollMs);
        entry = manager.getAgent(t.childId);
      }
      if (!entry?.session) {
        console.error(`[run-duel-cycle] ❌ ${t.sid} 子 session 5 分钟内未就绪，终止`);
        return 1;
      }
      console.log(
        `[run-duel-cycle] ${t.sid} 子 session 已就绪（status=${entry.status}），投递 run_cycle script=${t.scriptName} games=${args.games} review_every=${reviewEvery} …`,
      );
      const task = {
        type: "task" as const,
        action: "run_cycle" as const,
        script_name: t.scriptName,
        games: args.games,
        review_every: reviewEvery,
      };
      let ok = false;
      for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
        ok = await manager.sendTask(t.childId, task);
        if (!ok) {
          t.dispatchFailures++;
          console.log(`[run-duel-cycle] run_cycle 投递失败（第 ${attempt} 次），${args.pollMs}ms 后重试…`);
          await sleep(args.pollMs);
        }
      }
      if (!ok) {
        console.error(
          `[run-duel-cycle] ❌ ${t.sid} run_cycle 投递失败（controller/子 session 未就绪，重试 5 次仍失败），终止`,
        );
        return 1;
      }
      t.phase = "running";
      console.log(`[run-duel-cycle] ✅ ${t.sid} run_cycle 已投递，周期开始（等待自然结束，不发 stop）`);
    }

    // 3. 轮询等待两个周期自然结束
    const deadline = Date.now() + args.timeoutMin * 60_000;
    let lastSnapshot = "";
    while (true) {
      const snapshot = tracked
        .map((t) => {
          const entry = manager.getAgent(t.childId);
          return entry ? `${t.sid}=${t.phase}/${entry.driver.status}` : `${t.sid}=gone`;
        })
        .join(" ");
      if (snapshot !== lastSnapshot) {
        console.log(`[run-duel-cycle] ${new Date().toLocaleTimeString()} ${snapshot}`);
        lastSnapshot = snapshot;
      }

      for (const t of tracked) {
        if (t.phase !== "running") continue;
        const entry = manager.getAgent(t.childId);
        if (!entry) {
          t.phase = "terminated";
          console.log(`[run-duel-cycle] ⚠️ ${t.sid} 条目丢失（周期异常结束）`);
          continue;
        }
        // 自然完成：v_published 清空周期计时（cycleStartedAt 变回 null），driver 批次已 done
        if (entry.cycleStartedAt === null && entry.driver.status === "done") {
          t.phase = "done";
          console.log(
            `[run-duel-cycle] ✅ ${t.sid} 周期自然结束（v_published 闭环）${summarize(t, entry)}`,
          );
        } else if (entry.driver.status === "failed") {
          t.phase = "failed";
          console.log(
            `[run-duel-cycle] ⚠️ ${t.sid} driver 失败（周期异常结束）reason=${entry.driver.lastError ?? "未知"}`,
          );
        } else if (entry.status === "terminated") {
          t.phase = "terminated";
          console.log(`[run-duel-cycle] ⚠️ ${t.sid} 被回收（idle/cycle 超时强制回收，周期异常结束）`);
        }
      }

      if (tracked.every((t) => t.phase !== "running")) break;

      if (Date.now() > deadline) {
        console.error(
          `[run-duel-cycle] ⏰ 总超时 ${args.timeoutMin}min 到点，周期未自然结束，强制收尾。当前状态：`,
        );
        for (const t of tracked) {
          const entry = manager.getAgent(t.childId);
          if (entry) console.error(`  ${summarize(t, entry)}`);
          else console.error(`  ${t.sid}: 条目丢失`);
        }
        return 1;
      }
      await sleep(args.pollMs);
    }

    // 4. 汇总
    console.log("\n===== 双子 Agent 完整循环汇总 =====");
    let exitCode = 0;
    for (const t of tracked) {
      const entry = manager.getAgent(t.childId);
      if (!entry) {
        console.log(`  ${t.sid}: 条目丢失`);
        exitCode = 1;
        continue;
      }
      console.log(`  ${summarize(t, entry)}`);
      if (t.phase !== "done") exitCode = 1;
    }
    const allDone = tracked.every((t) => t.phase === "done");
    console.log(`\n结果：${allDone ? "✅ 两个子 Agent 周期均自然结束（未发 stop）" : "⚠️ 存在异常/超时，见上方状态"}（退出码 ${exitCode}）`);
    return exitCode;
  } finally {
    console.log("[run-duel-cycle] 清理：dispose 管理器（回收子 session）…");
    await manager.dispose();
    console.log("[run-duel-cycle] 已清理");
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error("[run-duel-cycle] 致命错误:", err);
    process.exit(1);
  });
