'use client';

import { memo, useMemo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { StarMap } from './StarMap';
import { PlayerHand } from './PlayerHand';
import { OpponentsPanel } from './PlayerPanel';
import { GameLog } from './GameLog';
import { StrikeMoveDialog, AnnounceStrikeDialog } from './StrikeDialog';
import { BroadcastResponseDialog, BroadcastSelectResponderDialog, AIVsAIBroadcastObserver } from './BroadcastDialog';
import { Badge } from '@/components/ui/badge';
import { useShallow } from 'zustand/shallow';

// 常量定义在组件外部避免每次渲染重新创建
const TURN_PHASE_LABELS: Record<string, string> = {
  turnBegin: '🌟 回合开始',
  strikeMovement: '💥 打击移动',
  drawPhase: '🃏 摸牌阶段',
  actionPhase: '🎯 行动阶段',
  turnEnd: '🔄 回合结束',
  interrupted: '⏸️ 回合中断',
};

// 使用 useShallow 优化选择器
const useGameShallow = <T,>(selector: (s: any) => T): T => {
  return useGameStore(useShallow(selector));
};

export const GameBoard = memo(() => {
  const phase = useGameStore((s) => s.phase);
  const totalTurn = useGameStore((s) => s.totalTurn);
  const turnPhase = useGameStore((s) => s.turnPhase);
  const currentPlayerIndex = useGameStore((s) => s.currentPlayerIndex);
  const humanPlayerId = useGameStore((s) => s.humanPlayerId);
  const drawPile = useGameStore((s) => s.drawPile);
  const discardPile = useGameStore((s) => s.discardPile);
  const flyingStrikes = useGameStore((s) => s.flyingStrikes);
  const pendingAction = useGameStore((s) => s.pendingAction);
  const players = useGameShallow((s: any) => s.players);

  const currentPlayer = players[currentPlayerIndex];
  const humanPlayer = useMemo(() => players.find((p: any) => p.id === humanPlayerId), [players, humanPlayerId]);
  const isHumanTurn = currentPlayer?.id === humanPlayerId;

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 text-white overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800/50">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            🌌 暗黑森林
          </h1>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">
            回合 {totalTurn}
          </Badge>
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${
            isHumanTurn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
          }`}>
            {isHumanTurn ? '▶ 你的回合' : `⏳ ${currentPlayer?.name} 的回合`}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span>🃏 牌堆: {drawPile.length}</span>
          <span>🗑️ 弃牌: {discardPile.length}</span>
          {flyingStrikes.length > 0 && (
            <span className="text-red-400">💥 飞行中: {flyingStrikes.length}</span>
          )}
        </div>
      </header>

      {/* Turn phase indicator */}
      <div className="flex-shrink-0 px-4 py-1 bg-slate-900/50 border-b border-slate-800/30">
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">{TURN_PHASE_LABELS[turnPhase] || turnPhase}</span>
          {pendingAction && (
            <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
              等待操作
            </Badge>
          )}
          {humanPlayer && !humanPlayer.eliminated && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs text-yellow-500">⚡ {humanPlayer.energy}</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-xs text-slate-400">📍 星系 {humanPlayer.position}</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-xs text-slate-400">🃏 {humanPlayer.hand.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Left: opponents */}
        <div className="w-48 flex-shrink-0 p-2 overflow-y-auto hidden lg:block">
          <OpponentsPanel />
        </div>

        {/* Center: star map + log */}
        <div className="flex-1 flex flex-col min-w-0 p-2 gap-2">
          {/* Star map */}
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="w-full max-w-2xl">
              <StarMap />
            </div>
          </div>

          {/* Game log */}
          <div className="flex-shrink-0">
            <GameLog />
          </div>

          {/* Mobile opponents */}
          <div className="flex-shrink-0 lg:hidden">
            <OpponentsPanel />
          </div>
        </div>

        {/* Right: flying strikes info */}
        <div className="w-48 flex-shrink-0 p-2 space-y-2 overflow-y-auto hidden xl:block">
          {flyingStrikes.length > 0 && (
            <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-2">
              <div className="text-xs font-bold text-red-400 mb-2">💥 飞行中的打击</div>
              {flyingStrikes.map((strike: any) => {
                const owner = players.find((p: any) => p.id === strike.ownerId);
                return (
                  <div key={strike.uid} className="text-[10px] text-slate-400 mb-1 p-1.5 bg-red-950/20 rounded">
                    <div className="text-red-300 font-bold">{strike.strikeName} (Lv.{strike.level})</div>
                    <div>发射者: {owner?.name}</div>
                    <div>位置: {strike.position} → 目标: {strike.targetSystem}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick reference */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-2">
            <div className="text-xs font-bold text-slate-400 mb-1">📖 快速参考</div>
            <div className="text-[9px] text-slate-600 space-y-0.5">
              <p>📡 广播: 博弈获取能量</p>
              <p>💥 打击: 清理其他文明</p>
              <p>🛡️ 防御: 抵御打击攻击</p>
              <p>🏭 设施: 能量产出/特殊能力</p>
              <p className="pt-1 text-slate-500">双方合作: 各+3⚡</p>
              <p className="text-slate-500">伪装成功: +5⚡</p>
              <p className="text-slate-500">双方伪装: 无收益</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: player hand */}
      {humanPlayer && !humanPlayer.eliminated && (
        <div className="flex-shrink-0 bg-slate-950/80 border-t border-slate-800/50">
          <PlayerHand />
        </div>
      )}

      {/* Human eliminated overlay */}
      {humanPlayer?.eliminated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="text-center">
            <span className="text-5xl">💀</span>
            <p className="text-xl font-bold text-red-400 mt-3">你的文明已被淘汰</p>
            <p className="text-sm text-slate-500 mt-1">观战模式 - 等待游戏结束</p>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <StrikeMoveDialog />
      <AnnounceStrikeDialog />
      <BroadcastResponseDialog />
      <BroadcastSelectResponderDialog />
      <AIVsAIBroadcastObserver />
    </div>
  );
});

GameBoard.displayName = 'GameBoard';
