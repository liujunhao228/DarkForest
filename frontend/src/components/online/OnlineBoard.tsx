import { memo, useEffect, useState, useRef } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { OnlineStarMap } from './OnlineStarMap';
import { OnlinePlayerHand } from './OnlinePlayerHand';
import { OnlineOpponentsPanel } from './OnlinePlayerPanel';
import { OnlineGameLog } from './OnlineGameLog';
import { OnlineStrikeMoveDialog, OnlineAnnounceStrikeDialog, OnlineStrikeSelectDialog } from './OnlineStrikeDialog';
import { OnlineBroadcastResponsePanel, OnlineBroadcastSelectResponderPanel } from './OnlineBroadcastPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Wifi, WifiOff, LogOut, Sparkles, Zap, Layers, RotateCw, Pause, MapPin, Trophy, Skull, BookOpen, Orbit, Crosshair, Trash2, Shield, Radio, Factory, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { BroadcastResponse } from '@/lib/game/types';
import { STRIKE_SHAPES, getOwnerColor } from '@/lib/game/strikeStyles';
import { StrikeShapeIcon } from './StrikeShapeIcon';

const TURN_PHASE_LABELS: Record<string, string> = {
  turnBegin: '回合开始', strikeMovement: '打击移动', drawPhase: '摸牌阶段',
  actionPhase: '行动阶段', turnEnd: '回合结束', interrupted: '回合中断',
};

const TURN_PHASE_ICONS: Record<string, React.ReactNode> = {
  turnBegin: <Sparkles className="w-3.5 h-3.5" />, strikeMovement: <Zap className="w-3.5 h-3.5" />,
  drawPhase: <Layers className="w-3.5 h-3.5" />, actionPhase: <Crosshair className="w-3.5 h-3.5" />,
  turnEnd: <RotateCw className="w-3.5 h-3.5" />, interrupted: <Pause className="w-3.5 h-3.5" />,
};

interface OnlineBoardProps {
  roomId: string;
  roomCode: string;
  onLeave: () => void;
}

export const OnlineBoard = memo(({ roomId, roomCode, onLeave }: OnlineBoardProps) => {
  void roomId;
  const { isConnected, gameState, disconnectedPlayers, requestSync, error, clearError } = useOnlineGameStore();
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [broadcastResponsePanelOpen, setBroadcastResponsePanelOpen] = useState(false);
  const [broadcastSelectPanelOpen, setBroadcastSelectPanelOpen] = useState(false);

  const initialSyncRequested = useRef(false);
  const notifiedPlayerIds = useRef<Set<string>>(new Set());
  const reconnectTimeoutIds = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!disconnectedPlayers || disconnectedPlayers.length === 0) return;
    const latestDisconnected = disconnectedPlayers[disconnectedPlayers.length - 1];
    if (notifiedPlayerIds.current.has(latestDisconnected.playerId)) return;
    notifiedPlayerIds.current.add(latestDisconnected.playerId);

    const reasonMessages: Record<string, string> = { timeout: '连接超时', network_error: '网络错误', client_closed: '客户端关闭' };

    toast.warning(`${latestDisconnected.displayName} 已断线`, {
      description: latestDisconnected.canReconnect ? `${reasonMessages[latestDisconnected.reason]}，等待重连...` : `${reasonMessages[latestDisconnected.reason]}，无法重连`,
      duration: latestDisconnected.canReconnect ? 8000 : 5000,
    });

    if (latestDisconnected.canReconnect && latestDisconnected.reconnectTimeout) {
      const playerId = latestDisconnected.playerId;
      const timeoutId = setTimeout(() => {
        toast.error(`${latestDisconnected.displayName} 重连失败`, { description: '超过重连时间，玩家已离线', duration: 5000 });
        reconnectTimeoutIds.current.delete(playerId);
      }, latestDisconnected.reconnectTimeout);
      reconnectTimeoutIds.current.set(playerId, timeoutId);
    }
    // 不再在 cleanup 中清除所有 timer，由重连清理 effect 和卸载 effect 负责
  }, [disconnectedPlayers]);

  // 玩家重连/离线后清理对应的 notifiedPlayerIds 和 timer，允许后续再次断线时重新提示
  useEffect(() => {
    if (!disconnectedPlayers) return;
    const currentIds = new Set(disconnectedPlayers.map((p) => p.playerId));
    for (const id of notifiedPlayerIds.current) {
      if (!currentIds.has(id)) {
        notifiedPlayerIds.current.delete(id);
        const tid = reconnectTimeoutIds.current.get(id);
        if (tid) {
          clearTimeout(tid);
          reconnectTimeoutIds.current.delete(id);
        }
      }
    }
  }, [disconnectedPlayers]);

  // 组件卸载时统一清理所有 timer
  useEffect(() => {
    const timeoutIds = reconnectTimeoutIds.current;
    return () => {
      timeoutIds.forEach((tid) => clearTimeout(tid));
      timeoutIds.clear();
    };
  }, []);

  const localPlayerId = useLocalPlayerId();

  useEffect(() => {
    if (initialSyncRequested.current) return;
    initialSyncRequested.current = true;
    requestSync();
    setLoadingTimeout(false);
    const timeout = setTimeout(() => {
      if (!useOnlineGameStore.getState().gameState) setLoadingTimeout(true);
    }, 15000);
    return () => clearTimeout(timeout);
  }, [requestSync]);

  useEffect(() => { if (isConnected) setLoadingTimeout(false); }, [isConnected]);

  useEffect(() => {
    if (!gameState) { setBroadcastResponsePanelOpen(false); setBroadcastSelectPanelOpen(false); return; }
    const { broadcast, localPlayerId: serverLocalPlayerId } = gameState;
    const effectiveLocalPlayerId = localPlayerId || serverLocalPlayerId;
    if (!broadcast || !broadcast.active) { setBroadcastResponsePanelOpen(false); setBroadcastSelectPanelOpen(false); return; }
    const humanResponse = broadcast.responses?.find((r: BroadcastResponse) => r.playerId === effectiveLocalPlayerId);
    const needsToRespond = humanResponse && humanResponse.canRespond && !humanResponse.responded;
    const isBroadcaster = broadcast.broadcasterId === effectiveLocalPlayerId;
    if (needsToRespond) { setBroadcastResponsePanelOpen(true); setBroadcastSelectPanelOpen(false); }
    else if (isBroadcaster) { setBroadcastSelectPanelOpen(true); setBroadcastResponsePanelOpen(false); }
    else { setBroadcastResponsePanelOpen(false); setBroadcastSelectPanelOpen(false); }
  }, [gameState, localPlayerId]);

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center space-y-4">
          {loadingTimeout ? (
            <>
              <div className="text-2xl text-red-400">加载失败</div>
              <div className="text-slate-400 text-sm">无法连接到游戏服务器，请检查网络连接</div>
              {error && <div className="text-red-400 text-sm bg-red-950/30 p-3 rounded max-w-md mx-auto">{error}</div>}
              <div className="flex gap-3 justify-center mt-4">
                <Button onClick={onLeave} variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">返回大厅</Button>
                <Button onClick={() => { setLoadingTimeout(false); requestSync(); }} className="bg-cyan-600 hover:bg-cyan-700">重新连接</Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl text-slate-400">加载中...</div>
              {error && <div className="text-red-400 text-sm">{error}<Button variant="link" onClick={clearError}>清除</Button></div>}
            </>
          )}
        </div>
      </div>
    );
  }

  const {
    players,
    currentPlayerIndex,
    localPlayerId: serverLocalPlayerId,
    totalTurn,
    turnPhase,
    flyingStrikes,
    pendingAction,
    phase,
    winner,
  } = gameState;

  // GameState 有 drawPile/discardPile，ViewState 没有；用 kind 显式判别
  const drawPile = gameState.kind === 'game' ? gameState.drawPile : undefined;
  const discardPile = gameState.kind === 'game' ? gameState.discardPile : undefined;

  const localPlayerIdFromState = localPlayerId || serverLocalPlayerId;
  const currentPlayer = players?.[currentPlayerIndex];
  const humanPlayer = players?.find(p => p.id === localPlayerIdFromState);
  const isHumanTurn = currentPlayer?.id === localPlayerIdFromState;

  const handleLeave = () => { onLeave(); };

  if (phase === 'gameOver' && winner) {
    const isHumanWinner = winner === localPlayerIdFromState;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="text-center space-y-6">
          <h1 className={`text-5xl font-bold ${isHumanWinner ? 'text-green-400' : 'text-red-400'}`}>
            {isHumanWinner ? <span className="flex items-center justify-center gap-3"><Trophy className="w-12 h-12" /> 胜利!</span> : <span className="flex items-center justify-center gap-3"><Skull className="w-12 h-12" /> 失败</span>}
          </h1>
          <p className="text-slate-400">{isHumanWinner ? '你的文明在黑暗森林中存活下来!' : '你的文明已被清理'}</p>
          <Button onClick={handleLeave} className="bg-gradient-to-r from-purple-600 to-cyan-600">返回大厅</Button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="h-screen flex flex-col bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 text-white overflow-hidden">
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800/50">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2">
            <Orbit className="w-4 h-4 text-purple-400" /> 暗黑森林 - 在线
          </h1>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">{roomCode}</Badge>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">回合 {totalTurn}</Badge>
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${isHumanTurn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
            {isHumanTurn ? '▶ 你的回合' : `⏳ ${currentPlayer?.name} 的回合`}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          {gameState.kind === 'game' && (
            <>
              <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> 牌堆: {drawPile?.length || 0}</span>
              <span className="flex items-center gap-1"><Trash2 className="w-3 h-3" /> 弃牌: {discardPile?.length || 0}</span>
            </>
          )}
          {flyingStrikes && flyingStrikes.length > 0 && <span className="text-red-400 flex items-center gap-1"><Zap className="w-3 h-3" /> 飞行中: {flyingStrikes.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isConnected ? 'border-green-500 text-green-400' : 'border-red-500 text-red-400'}`}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </Badge>
          <Button variant="ghost" size="sm" onClick={handleLeave} className="h-8 w-8 p-0 hover:bg-red-950/30 hover:text-red-400"><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>

      <div className="flex-shrink-0 px-4 py-1 bg-slate-900/50 border-b border-slate-800/30">
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 flex items-center gap-1">{TURN_PHASE_ICONS[turnPhase] || null}{TURN_PHASE_LABELS[turnPhase] || turnPhase}</span>
          {!!pendingAction && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">等待操作</Badge>}
          {humanPlayer && !humanPlayer.eliminated && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-xs text-yellow-500 flex items-center gap-1"><Zap className="w-3 h-3" /> {humanPlayer.energy}</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-xs text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> 星系 {humanPlayer.position}</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-xs text-slate-400 flex items-center gap-1"><Layers className="w-3 h-3" /> {humanPlayer.hand?.length ?? 0}</span>
            </div>
          )}
        </div>
      </div>

      {/* 悬停打击警告：当前玩家所在星系有待生效打击 */}
      {humanPlayer && !humanPlayer.eliminated && flyingStrikes && flyingStrikes.some(s => s.arrived && s.targetSystem === humanPlayer.position && s.ownerId !== humanPlayer.id) && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-red-950/50 border-b border-red-900/50 animate-pulse">
          <span className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> 你所在星系有待生效打击！
          </span>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="w-48 flex-shrink-0 p-2 overflow-y-auto hidden lg:block"><OnlineOpponentsPanel /></div>
        <div className="flex-1 flex flex-col min-w-0 p-2 gap-2">
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="w-full max-w-2xl"><OnlineStarMap /></div>
          </div>
          <div className="flex-shrink-0"><OnlineGameLog /></div>
          <div className="flex-shrink-0 lg:hidden"><OnlineOpponentsPanel /></div>
        </div>
        <div className="w-48 flex-shrink-0 p-2 space-y-2 overflow-y-auto hidden xl:block">
          {flyingStrikes && flyingStrikes.length > 0 && (
            <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-2">
              <div className="text-xs font-bold text-red-400 mb-2 flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> 飞行中的打击</div>
              {flyingStrikes.map((strike) => {
                const owner = players.find(p => p.id === strike.ownerId);
                const isOwn = strike.ownerId === localPlayerIdFromState;
                const isPendingMove = !!pendingAction && typeof pendingAction === 'object' && 'strikeUid' in pendingAction && (pendingAction as { strikeUid: string }).strikeUid === strike.uid;
                const ownerColor = getOwnerColor(strike.ownerId, players);
                const shape = STRIKE_SHAPES[strike.defId] ?? 'circle';
                return (
                  <div key={strike.uid} className={`text-[10px] text-slate-400 mb-1 p-1.5 bg-red-950/20 rounded ${isPendingMove ? 'ring-1 ring-red-500/50' : ''}`}
                    style={{ borderLeft: `2px solid ${ownerColor}` }}>
                    <div className="text-red-300 font-bold flex items-center gap-1">
                      <StrikeShapeIcon shape={shape} color={ownerColor} className="w-3 h-3 flex-shrink-0" />
                      {strike.strikeName} (Lv.{strike.level}){strike.arrived && ' · 待命'}
                    </div>
                    <div>发射者: {owner?.name}{isOwn ? ' (你)' : ''}</div>
                    <div>位置: {strike.position} → 目标: {strike.targetSystem}</div>
                    {isPendingMove && isOwn && (
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('reopen-strike-move-dialog'))}
                        className="mt-1 w-full text-[10px] text-cyan-400 hover:text-cyan-300 border border-cyan-700/50 rounded py-0.5 transition-colors"
                      >
                        点击操作此打击
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
            <div className="text-sm font-bold text-slate-400 mb-2 flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> 快速参考</div>
            <div className="text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
              <p className="flex items-center gap-1.5"><Radio className="w-3 h-3 text-cyan-400" /><span className="text-slate-300">广播:</span> 博弈获取能量</p>
              <p className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-red-400" /><span className="text-slate-300">打击:</span> 清理其他文明</p>
              <p className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-blue-400" /><span className="text-slate-300">防御:</span> 抵御打击攻击</p>
              <p className="flex items-center gap-1.5"><Factory className="w-3 h-3 text-amber-400" /><span className="text-slate-300">设施:</span> 能量产出/特殊能力</p>
              <div className="border-t border-slate-800/50 pt-2 mt-2">
                <p className="text-slate-400 flex items-center gap-1.5"><span className="text-emerald-400 font-medium">双方合作:</span> 各+3<Zap className="w-3 h-3" /></p>
                <p className="text-slate-400 flex items-center gap-1.5"><span className="text-emerald-400 font-medium">伪装成功:</span> +5<Zap className="w-3 h-3" /></p>
                <p className="text-slate-400 flex items-center gap-1.5"><span className="text-slate-500 font-medium">双方伪装:</span> 无收益</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {humanPlayer && !humanPlayer.eliminated && (
        <div className="flex-shrink-0 bg-slate-950/80 border-t border-slate-800/50"><OnlinePlayerHand /></div>
      )}

      {humanPlayer?.eliminated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="text-center">
            <Skull className="w-16 h-16 mx-auto text-red-400" />
            <p className="text-xl font-bold text-red-400 mt-3">你的文明已被淘汰</p>
            <p className="text-sm text-slate-500 mt-1">观战模式 - 等待游戏结束</p>
          </div>
        </div>
      )}

      <OnlineStrikeSelectDialog />
      <OnlineStrikeMoveDialog />
      <OnlineAnnounceStrikeDialog />
      <OnlineBroadcastResponsePanel isOpen={broadcastResponsePanelOpen} onClose={() => setBroadcastResponsePanelOpen(false)} />
      <OnlineBroadcastSelectResponderPanel isOpen={broadcastSelectPanelOpen} onClose={() => setBroadcastSelectPanelOpen(false)} />
    </div>
    </TooltipProvider>
  );
});

OnlineBoard.displayName = 'OnlineBoard';
