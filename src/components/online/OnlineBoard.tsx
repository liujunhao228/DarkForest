'use client';

import { memo, useEffect, useState } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { OnlineStarMap } from './OnlineStarMap';
import { OnlinePlayerHand } from './OnlinePlayerHand';
import { OnlineOpponentsPanel } from './OnlinePlayerPanel';
import { OnlineGameLog } from './OnlineGameLog';
import { StrikeMoveDialog, AnnounceStrikeDialog } from '@/components/game/StrikeDialog';
import { BroadcastResponseDialog, BroadcastSelectResponderDialog } from '@/components/game/BroadcastDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Wifi, WifiOff, LogOut } from 'lucide-react';

interface OnlineBoardProps {
  roomId: string;
  roomCode: string;
  onLeave: () => void;
}

export function OnlineBoard({ roomId, roomCode, onLeave }: OnlineBoardProps) {
  const {
    isConnected,
    gameState,
    roomPlayers,
    sendAction,
    requestSync,
    error,
    clearError,
  } = useOnlineGameStore();

  const [loadingTimeout, setLoadingTimeout] = useState(false);

  // 请求初始同步 + 超时控制
  useEffect(() => {
    requestSync();
    setLoadingTimeout(false);

    // 15秒超时
    const timeout = setTimeout(() => {
      if (!gameState) {
        setLoadingTimeout(true);
      }
    }, 15000);

    return () => clearTimeout(timeout);
  }, [requestSync, gameState]);

  // 连接断开时重置超时
  useEffect(() => {
    if (isConnected) {
      setLoadingTimeout(false);
    }
  }, [isConnected]);

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center space-y-4">
          {loadingTimeout ? (
            <>
              <div className="text-2xl text-red-400">加载失败</div>
              <div className="text-slate-400 text-sm">无法连接到游戏服务器，请检查网络连接</div>
              {error && (
                <div className="text-red-400 text-sm bg-red-950/30 p-3 rounded max-w-md mx-auto">
                  {error}
                </div>
              )}
              <div className="flex gap-3 justify-center mt-4">
                <Button onClick={onLeave} variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">
                  返回大厅
                </Button>
                <Button onClick={() => { setLoadingTimeout(false); requestSync(); }} className="bg-cyan-600 hover:bg-cyan-700">
                  重新连接
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl text-slate-400">加载中...</div>
              {error && (
                <div className="text-red-400 text-sm">
                  {error}
                  <Button variant="link" onClick={clearError}>清除</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const {
    players,
    currentPlayerIndex,
    humanPlayerId,
    totalTurn,
    turnPhase,
    drawPile,
    discardPile,
    flyingStrikes,
    pendingAction,
    phase,
    winner,
  } = gameState;

  const currentPlayer = players?.[currentPlayerIndex];
  const humanPlayer = players?.find((p) => p.id === humanPlayerId);
  const isHumanTurn = currentPlayer?.id === humanPlayerId;

  const handleLeave = () => {
    onLeave();
  };

  if (phase === 'gameOver' && winner) {
    const isHumanWinner = winner === humanPlayerId;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="text-center space-y-6">
          <h1 className={`text-5xl font-bold ${isHumanWinner ? 'text-green-400' : 'text-red-400'}`}>
            {isHumanWinner ? '🎉 胜利!' : '💀 失败'}
          </h1>
          <p className="text-slate-400">
            {isHumanWinner ? '你的文明在黑暗森林中存活下来!' : '你的文明已被清理'}
          </p>
          <Button onClick={handleLeave} className="bg-gradient-to-r from-purple-600 to-cyan-600">
            返回大厅
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 text-white overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800/50">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            🌌 暗黑森林 - 在线
          </h1>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">
            {roomCode}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">
            回合 {totalTurn}
          </Badge>
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${
            isHumanTurn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'
          }`}>
            {isHumanTurn ? '▶ 你的回合' : `⏳ ${currentPlayer?.name} 的回合`}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
            isConnected ? 'border-green-500 text-green-400' : 'border-red-500 text-red-400'
          }`}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLeave}
            className="h-8 w-8 p-0 hover:bg-red-950/30 hover:text-red-400"
          >
            <LogOut className="w-4 h-4" />
          </Button>
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
          <OnlineOpponentsPanel />
        </div>

        {/* Center: star map + log */}
        <div className="flex-1 flex flex-col min-w-0 p-2 gap-2">
          {/* Star map */}
          <div className="flex-1 min-h-0 bg-slate-900/30 rounded-lg border border-slate-800/50 overflow-hidden">
            <OnlineStarMap />
          </div>

          {/* Game log */}
          <div className="h-32 flex-shrink-0">
            <OnlineGameLog />
          </div>
        </div>

        {/* Right: player hand */}
        <div className="w-80 flex-shrink-0 p-2 overflow-y-auto hidden md:block">
          <OnlinePlayerHand />
        </div>
      </div>

      {/* Dialogs */}
      {pendingAction?.type === 'strikeMove' && (
        <StrikeMoveDialog />
      )}
      {pendingAction?.type === 'announceStrike' && (
        <AnnounceStrikeDialog />
      )}
      {pendingAction?.type === 'broadcastResponse' && (
        <BroadcastResponseDialog />
      )}
      {pendingAction?.type === 'broadcastSelect' && (
        <BroadcastSelectResponderDialog />
      )}
    </div>
  );
}

const TURN_PHASE_LABELS: Record<string, string> = {
  turnBegin: '🌟 回合开始',
  strikeMovement: '💥 打击移动',
  drawPhase: '🃏 摸牌阶段',
  actionPhase: '🎯 行动阶段',
  turnEnd: '🔄 回合结束',
  interrupted: '⏸️ 回合中断',
};
