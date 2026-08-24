/**
 * orchestrator 配置读取。
 *
 * 与仓库其余服务一致：不做 .env 自动加载（无 dotenv），宿主须显式注入
 * 环境变量（如 scripts/up.ps1）。所有键均有合理默认值，便于本地直跑。
 */

export interface OrchestratorConfig {
  /** HTTP 服务端口 */
  port: number;
  /** deepseek-harness 根目录（dsh CLI 所在） */
  dshRoot: string;
  /** dsh CLI profile 名 */
  profile: string;
  /** 可分配的 AI 玩家 sid 池（来自 up.ps1 与 mcpserver AGENT_SEED_NAME 同源对齐） */
  seedSids: string[];
}

const DEFAULT_DSH_ROOT = 'E:/deepseek-harness';
const DEFAULT_PROFILE = 'darkforest';

function splitSids(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  const port = Number(env.ORCHESTRATOR_PORT ?? '9092');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`ORCHESTRATOR_PORT 非法: ${env.ORCHESTRATOR_PORT}`);
  }
  return {
    port,
    dshRoot: env.DSH_ROOT || DEFAULT_DSH_ROOT,
    profile: env.DF_PROFILE || DEFAULT_PROFILE,
    seedSids: splitSids(env.ORCHESTRATOR_SEED_SIDS),
  };
}
