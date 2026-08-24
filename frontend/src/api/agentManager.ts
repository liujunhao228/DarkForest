// orchestrator（E:\DarkForest\orchestrator）HTTP API 客户端。
// 用于"创建一局"（batch spawn N 个 dsh agent 入队）与"旁观"（枚举正在打牌的 agent）。
// 编排壳对 agent 大脑实现无感知（brain-agnostic）：只负责拉起/枚举/中止以
// sid 为标识、能连后端打牌的 dsh 进程。游戏私有视野不走此接口（走 backend observer）。

const BASE = import.meta.env.VITE_ORCHESTRATOR_URL || 'http://localhost:9092';

export interface AgentInfo {
  /** dsh agent 进程的 sid（即 backend 的 agent:<sid>） */
  sid: string;
  status: string;
  exitCode: number | null;
  startedAt: number;
}

export interface AgentDetail extends AgentInfo {
  logTail: string[];
}

export async function listAgents(): Promise<AgentInfo[]> {
  const res = await fetch(`${BASE}/api/agents`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { agents: AgentInfo[] };
  return body.agents;
}

/**
 * 组局拉起 N 个 dsh agent，任务文本（加入指定 specific queue 打完整局）由 orchestrator 生成。
 * @param params.count - 拉起数量（1-4）。
 * @param params.queueId - 前端 match:createQueue 返回的队列 ID（写入任务文本）。
 * @param params.gameMode - 可选对局模式（classic / civilization_relics）。
 * @returns 已 spawn 的 agent sid 列表（用于取消时清理）。
 */
export async function spawnBatch(params: { count: number; queueId: string; gameMode?: string }): Promise<{ sids: string[] }> {
  const res = await fetch(`${BASE}/api/agents/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: params.count, queueId: params.queueId, gameMode: params.gameMode }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ sids: string[] }>;
}

export async function getAgent(sid: string): Promise<AgentDetail> {
  const res = await fetch(`${BASE}/api/agents/${encodeURIComponent(sid)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AgentDetail>;
}

export async function killAgent(sid: string): Promise<void> {
  const res = await fetch(`${BASE}/api/agents/${encodeURIComponent(sid)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
