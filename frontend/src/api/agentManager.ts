// dsh-darkforest-gui 插件 HTTP API 客户端。
// 用于"创建一局"（spawn N 个 dsh agent）与"旁观"（枚举正在打牌的 agent）。
// 编排壳对 agent 大脑实现无感知（brain-agnostic）：只负责拉起/枚举/中止以
// sid 为标识、能连后端打牌的 dsh 进程。游戏私有视野不走此接口（走 backend observer）。

const BASE = import.meta.env.VITE_AGENT_MANAGER_URL || 'http://localhost:9092';

export interface AgentInfo {
  /** dsh agent 进程的 sid（即 backend 的 agent:<sid>） */
  sid: string;
  status: string;
  exitCode: number | null;
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

export async function spawnAgents(params: { count: number; prefix?: string }): Promise<{ agents: AgentInfo[] }> {
  const res = await fetch(`${BASE}/api/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: params.count, prefix: params.prefix }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ agents: AgentInfo[] }>;
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