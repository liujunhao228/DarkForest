import { useMemo, useState } from 'react';
import { OnlineStarMap } from '@/components/online/OnlineStarMap';
import { STAR_NODES } from '@/lib/game/starmap';
import type { ViewState } from '@/lib/game/viewState';

// 开发专用星图视觉实验室：mock ViewState 直灌 OnlineStarMap（回放模式同款 props 通道），
// 无需登录/匹配/对局推进即可验证星系状态视觉（毁星余烬、湮灭余波、降维锁定）。
// 路由在 main.tsx 中以 import.meta.env.DEV 门控，生产构建不含本页面。

const BASE_PLAYERS: ViewState['players'] = [
  { id: 'p1', name: '观测者', color: 'blue', position: 5, energy: 8, handCount: 4, faceUpCards: [], eliminated: false, broadcastHistory: [] },
  { id: 'p2', name: '监听者', color: 'red', position: 8, energy: 5, handCount: 3, faceUpCards: [], eliminated: false, broadcastHistory: [] },
];

function buildMockState(overrides: Partial<ViewState>): ViewState {
  return {
    kind: 'view',
    phase: 'playing',
    gameMode: 'classic',
    totalTurn: 10,
    playerCount: 2,
    players: BASE_PLAYERS,
    currentPlayerIndex: 0,
    currentPlayerId: 'p1',
    localPlayerId: 'p1',
    flyingStrikes: [],
    broadcast: null,
    turnPhase: 'action',
    pendingAction: null,
    logs: [],
    destroyedStars: [],
    starEffects: [],
    winner: null,
    isProcessing: false,
    _viewMeta: { role: 'REPLAY', timestamp: Date.now() },
    ...overrides,
  };
}

export default function DevStarMapLab() {
  // 毁星星系集合
  const [destroyed, setDestroyed] = useState<number[]>([3]);
  // 湮灭余波：星系 → 施加时回合（剩余 = appliedAt + 5 - totalTurn）
  const [stunSystems, setStunSystems] = useState<number[]>([7]);
  // 降维锁定星系集合（对照用，视觉保持现状）
  const [dimLocked, setDimLocked] = useState<number[]>([2]);
  // 总回合数：步进以观察余波透明度衰减
  const [totalTurn, setTotalTurn] = useState(10);

  const gameState = useMemo<ViewState>(() => buildMockState({
    totalTurn,
    destroyedStars: destroyed,
    starEffects: [
      ...stunSystems.map(id => ({
        systemId: id,
        type: 'annihilationStun' as const,
        appliedAtTurn: 10,
        duration: 5,
      })),
      ...dimLocked.map(id => ({
        systemId: id,
        type: 'dimensionalLock' as const,
        appliedAtTurn: 6,
        duration: -1,
      })),
    ],
  }), [destroyed, stunSystems, dimLocked, totalTurn]);

  const toggle = (list: number[], setList: (v: number[]) => void, id: number) => {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const chipCls = (active: boolean, activeColor: string) =>
    `min-w-[2rem] px-1.5 py-1 rounded text-[11px] font-mono border transition-colors ${
      active ? activeColor : 'border-slate-700 text-slate-400 hover:bg-slate-800'
    }`;

  const stunRemaining = stunSystems.length > 0
    ? Math.max(1, 10 + 5 - totalTurn)
    : null;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 text-slate-200 p-4">
      <div className="max-w-5xl mx-auto">
        <header className="mb-3">
          <h1 className="text-lg font-bold text-slate-100">星图视觉实验室 <span className="text-xs font-normal text-slate-500">/dev/starmap-lab · 仅开发环境</span></h1>
          <p className="text-xs text-slate-500 mt-0.5">点击星系 ID 切换状态；步进回合观察湮灭余波透明度衰减（施加于回合 10，持续 5 回合）</p>
        </header>

        <div className="flex flex-col lg:flex-row gap-4 items-start">
          {/* 星图本体 */}
          <div className="w-full lg:w-[560px] shrink-0 aspect-square">
            <OnlineStarMap gameState={gameState} replayMode />
          </div>

          {/* 控制面板 */}
          <div className="flex-1 space-y-4 text-xs w-full">
            <section>
              <h2 className="font-bold text-orange-400 mb-1.5">恒星毁灭（余烬）</h2>
              <div className="flex flex-wrap gap-1">
                {STAR_NODES.map(n => (
                  <button key={`d-${n.id}`} onClick={() => toggle(destroyed, setDestroyed, n.id)}
                    className={chipCls(destroyed.includes(n.id), 'border-orange-500/60 bg-orange-950/60 text-orange-300')}>
                    {n.id}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-bold text-violet-400 mb-1.5">湮灭余波（紊乱能量场）</h2>
              <div className="flex flex-wrap gap-1">
                {STAR_NODES.map(n => (
                  <button key={`s-${n.id}`} onClick={() => toggle(stunSystems, setStunSystems, n.id)}
                    className={chipCls(stunSystems.includes(n.id), 'border-violet-500/60 bg-violet-950/60 text-violet-300')}>
                    {n.id}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-slate-400">总回合 {totalTurn}</span>
                <button onClick={() => setTotalTurn(t => Math.max(10, t - 1))}
                  className="px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">-1</button>
                <button onClick={() => setTotalTurn(t => Math.min(15, t + 1))}
                  className="px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">+1</button>
                {stunRemaining != null && (
                  <span className="text-violet-300/80">余波剩余 {stunRemaining} 回合</span>
                )}
              </div>
            </section>

            <section>
              <h2 className="font-bold text-slate-400 mb-1.5">降维锁定（对照 · 保持现状）</h2>
              <div className="flex flex-wrap gap-1">
                {STAR_NODES.map(n => (
                  <button key={`l-${n.id}`} onClick={() => toggle(dimLocked, setDimLocked, n.id)}
                    className={chipCls(dimLocked.includes(n.id), 'border-slate-400/60 bg-slate-700/60 text-slate-200')}>
                    {n.id}
                  </button>
                ))}
              </div>
            </section>

            <section className="text-slate-500 leading-relaxed border-t border-slate-800 pt-3">
              <p>对照检查项：余烬呼吸/火星漂移是否自然；余波环反向旋转与衰减；三种状态 + 正常星系同框时色彩语义是否混淆；拖窄窗口 &lt;360px 验证紧凑模式；系统开启 prefers-reduced-motion 后应全部退化为静态。</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
