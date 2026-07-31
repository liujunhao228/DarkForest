import { memo, useEffect, useState, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import {
  usePlayers,
  usePendingAction,
  useTurnPhase,
  useTotalTurn,
  useCurrentPlayerIndex,
  useGamePhase,
  useWinner,
  useBroadcast,
  useFlyingStrikes,
  useLocalPlayerId as useStoreLocalPlayerId,
} from '@/store/onlineGameStore/selectors';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { useIsMobile } from '@/hooks/use-mobile';
import { OnlineStarMap } from './OnlineStarMap';
import { OnlinePlayerHand } from './OnlinePlayerHand';
import { OnlineOpponentsPanel } from './OnlinePlayerPanel';
import { OnlineGameLog } from './OnlineGameLog';
import { OnlineStrikeMoveDialog, OnlineAnnounceStrikeDialog, OnlineStrikeSelectDialog, OnlineStrikeMissedDialog } from './OnlineStrikeDialog';
import { OnlineBroadcastResponsePanel, OnlineBroadcastSelectResponderPanel } from './OnlineBroadcastPanel';
import { OnlineRelicRevealDialog } from './OnlineRelicRevealDialog';
import { OnlineNotepad } from './OnlineNotepad';
import { OnlineMarkerManager } from './OnlineMarkerManager';
import { StrikeWarningBar } from './StrikeWarningBar';
import { FlyingStrikesList } from './FlyingStrikesList';
import { usePlayerPanelMode, PANEL_MODE_LABELS, PANEL_MODE_ORDER } from '@/hooks/usePlayerPanelMode';
import { useDoorCardDisplayMode, DOOR_CARD_MODE_LABELS, DOOR_CARD_MODE_ORDER } from '@/hooks/useDoorCardDisplayMode';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Wifi, WifiOff, LogOut, Sparkles, Zap, Layers, RotateCw, Pause, MapPin, Trophy, Skull, BookOpen, Orbit, Crosshair, Trash2, Shield, Radio, Factory, MoreVertical, X } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import type { BroadcastResponse } from '@/lib/game/types';
import { GameRulesPanel } from '@/components/rules/GameRulesPanel';
import { GameRulesButton } from '@/components/rules/GameRulesButton';
import {
  TURN_PHASE_LABELS,
  DISCONNECT_REASON_MESSAGES,
  RECONNECT_FAILED_DESC,
  LOAD_FAILED,
  LOADING_TEXT,
  GAME_OVER,
  HEADER,
  QUICK_REF,
  ELIMINATED,
} from '@/constants/gameText';

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
  // 按字段 selector 订阅，避免 store 任意字段变化（pendingAction/isProcessing/roomPlayers 等）触发整棵游戏树重渲染
  // gameState 仍整体订阅：用于 null check + gameOver + kind/gameMode/modeRules/drawPile/discardPile
  const gameState = useOnlineGameStore((s) => s.gameState);
  const { isConnected, disconnectedPlayers, error } = useOnlineGameStore(
    useShallow((s) => ({
      isConnected: s.isConnected,
      disconnectedPlayers: s.disconnectedPlayers,
      error: s.error,
    }))
  );
  // 函数引用稳定，单字段订阅不会触发重渲染
  const requestSync = useOnlineGameStore((s) => s.requestSync);
  const clearError = useOnlineGameStore((s) => s.clearError);

  // P2-2 Task 4: 字段级 selector 订阅，替代从 gameState 直接提取
  const players = usePlayers();
  const pendingAction = usePendingAction();
  const turnPhase = useTurnPhase();
  const totalTurn = useTotalTurn();
  const currentPlayerIndex = useCurrentPlayerIndex();
  const phase = useGamePhase();
  const winner = useWinner();
  const broadcast = useBroadcast();
  const flyingStrikes = useFlyingStrikes();
  const serverLocalPlayerId = useStoreLocalPlayerId();

  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [broadcastResponsePanelOpen, setBroadcastResponsePanelOpen] = useState(false);
  const [broadcastSelectPanelOpen, setBroadcastSelectPanelOpen] = useState(false);
  // 星图标记模式：点击玩家面板"位置"区域进入，再次点击同一玩家或按 ESC 退出
  // 状态在顶层 OnlineBoard 持有，向下传给 OnlineOpponentsPanel（toggle）与 OnlineStarMap（放图钉 + ESC 退出）
  const [markingMode, setMarkingMode] = useState<{ playerId: string; color: string } | null>(null);
  // 玩家状态栏显示模式（详细/简略/极简），全局持久化偏好
  const { mode: panelMode, setMode: setPanelMode } = usePlayerPanelMode();
  // 移动端场上门牌展示模式（默认图文 / 简略文字），全局持久化偏好
  const { mode: doorCardMode, setMode: setDoorCardMode } = useDoorCardDisplayMode();
  // 游戏规则面板（compact 模式）
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  // 移动端"更多"抽屉：收纳 panel mode toggle、规则入口、牌堆/弃牌/飞行中计数、退出按钮
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // 点击玩家位置区域：同一玩家再次点击则退出（toggle），否则切换到该玩家
  // P1-4: useCallback 化以保持引用稳定，使 memo 化的 OnlineOpponentsPanel 在 OnlineBoard
  // 重渲染时跳过（避免每次重渲染都向子组件传入新函数引用导致 memo 失效）
  const handlePositionClick = useCallback((playerId: string, color: string) => {
    setMarkingMode((prev) => (prev?.playerId === playerId ? null : { playerId, color }));
  }, []);

  const initialSyncRequested = useRef(false);
  const notifiedPlayerIds = useRef<Set<string>>(new Set());
  const reconnectTimeoutIds = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // P0-B2: 合并 disconnectedPlayers 相关 effect：新增断线提示 + 重连/离线清理，避免级联触发
  useEffect(() => {
    if (!disconnectedPlayers || disconnectedPlayers.length === 0) {
      // 所有人都已重连，清理所有 notifiedPlayerIds 和 timer
      for (const id of notifiedPlayerIds.current) {
        const tid = reconnectTimeoutIds.current.get(id);
        if (tid) {
          clearTimeout(tid);
          reconnectTimeoutIds.current.delete(id);
        }
      }
      notifiedPlayerIds.current.clear();
      return;
    }

    // 处理新增：最新断线玩家
    const latestDisconnected = disconnectedPlayers[disconnectedPlayers.length - 1];
    if (!notifiedPlayerIds.current.has(latestDisconnected.playerId)) {
      notifiedPlayerIds.current.add(latestDisconnected.playerId);

      toast.warning(`${latestDisconnected.displayName} 已断线`, {
        description: latestDisconnected.canReconnect ? `${DISCONNECT_REASON_MESSAGES[latestDisconnected.reason]}，等待重连...` : `${DISCONNECT_REASON_MESSAGES[latestDisconnected.reason]}，无法重连`,
        duration: latestDisconnected.canReconnect ? 8000 : 5000,
      });

      if (latestDisconnected.canReconnect && latestDisconnected.reconnectTimeout) {
        const playerId = latestDisconnected.playerId;
        const timeoutId = setTimeout(() => {
          toast.error(`${latestDisconnected.displayName} 重连失败`, { description: RECONNECT_FAILED_DESC, duration: 5000 });
          reconnectTimeoutIds.current.delete(playerId);
        }, latestDisconnected.reconnectTimeout);
        reconnectTimeoutIds.current.set(playerId, timeoutId);
      }
    }

    // 处理移除：已重连/离线玩家，清理对应的 notifiedPlayerIds 和 timer
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
  // 自适应布局：768px 以下视为移动端,用于 JS 端条件渲染(替代部分 CSS 媒体查询无法覆盖的场景)
  const isMobile = useIsMobile();

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

  // P0-B2: 依赖收敛为 broadcast（来自 selector），避免 logs/players 等无关字段变化触发
  useEffect(() => {
    if (!broadcast) { setBroadcastResponsePanelOpen(false); setBroadcastSelectPanelOpen(false); return; }
    const effectiveLocalPlayerId = localPlayerId || serverLocalPlayerId;
    const humanResponse = broadcast.responses?.find((r: BroadcastResponse) => r.playerId === effectiveLocalPlayerId);
    const needsToRespond = humanResponse && humanResponse.canRespond && !humanResponse.responded;
    const isBroadcaster = broadcast.broadcasterId === effectiveLocalPlayerId;
    if (needsToRespond) { setBroadcastResponsePanelOpen(true); setBroadcastSelectPanelOpen(false); }
    else if (isBroadcaster) { setBroadcastSelectPanelOpen(true); setBroadcastResponsePanelOpen(false); }
    else { setBroadcastResponsePanelOpen(false); setBroadcastSelectPanelOpen(false); }
  }, [broadcast, localPlayerId, serverLocalPlayerId]);

  // P2-2 Task 4: humanPlayer 从 players.find 获取（playersById 已移入 FlyingStrikesList）
  const localPlayerIdFromState = localPlayerId || serverLocalPlayerId;
  const humanPlayer = localPlayerIdFromState ? players.find((p) => p.id === localPlayerIdFromState) : undefined;

  // P1-4: 稳定 handleLeave 引用（虽然只传给 Button onClick，但保持一致性）
  const handleLeave = useCallback(() => { onLeave(); }, [onLeave]);
  // P1-4: 稳定 onExitMarkingMode 引用，避免每次 OnlineBoard 重渲染都向 OnlineStarMap
  // 传入新函数引用（OnlineStarMap 内部 useEffect 依赖此值）
  const handleExitMarkingMode = useCallback(() => { setMarkingMode(null); }, []);
  // P1-4: 稳定广播面板 onClose 引用
  const handleCloseBroadcastResponse = useCallback(() => setBroadcastResponsePanelOpen(false), []);
  const handleCloseBroadcastSelect = useCallback(() => setBroadcastSelectPanelOpen(false), []);

  // 改造 2: 提取右侧栏内容为内部函数,在桌面端 xl:block 与移动端 xl:hidden 折叠兜底两处复用,
  // 避免维护两份相同内容(快速参考卡片)
  // P1-4: useCallback 化以稳定引用，避免每次渲染创建新函数导致内部 map 每次重新执行
  // （即便结果是相同的 React 元素树，React 仍需重新协调）
  const renderQuickRef = useCallback(() => (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
      <div className="text-sm font-bold text-slate-400 mb-2 flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> {QUICK_REF.title}</div>
      <div className="text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
        <p className="flex items-center gap-1.5"><Radio className="w-3 h-3 text-cyan-400" /><span className="text-slate-300">{QUICK_REF.broadcast}:</span> {QUICK_REF.broadcastDesc}</p>
        <p className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-red-400" /><span className="text-slate-300">{QUICK_REF.strike}:</span> {QUICK_REF.strikeDesc}</p>
        <p className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-blue-400" /><span className="text-slate-300">{QUICK_REF.defense}:</span> {QUICK_REF.defenseDesc}</p>
        <p className="flex items-center gap-1.5"><Factory className="w-3 h-3 text-amber-400" /><span className="text-slate-300">{QUICK_REF.facility}:</span> {QUICK_REF.facilityDesc}</p>
        <div className="border-t border-slate-800/50 pt-2 mt-2">
          <p className="text-slate-400 flex items-center gap-1.5"><span className="text-emerald-400 font-medium">{QUICK_REF.bothCoop}:</span> {QUICK_REF.bothCoopDesc}<Zap className="w-3 h-3" /></p>
          <p className="text-slate-400 flex items-center gap-1.5"><span className="text-emerald-400 font-medium">{QUICK_REF.disguiseSuccess}:</span> {QUICK_REF.disguiseSuccessDesc}<Zap className="w-3 h-3" /></p>
          <p className="text-slate-400 flex items-center gap-1.5"><span className="text-slate-500 font-medium">{QUICK_REF.bothDisguise}:</span> {QUICK_REF.bothDisguiseDesc}</p>
        </div>
      </div>
    </div>
  ), []);

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        <div className="text-center space-y-4">
          {loadingTimeout ? (
            <>
              <div className="text-2xl text-red-400">{LOAD_FAILED.title}</div>
              <div className="text-slate-400 text-sm">{LOAD_FAILED.desc}</div>
              {error && <div className="text-red-400 text-sm bg-red-950/30 p-3 rounded max-w-md mx-auto">{error}</div>}
              <div className="flex gap-3 justify-center mt-4">
                <Button onClick={onLeave} variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800">{LOAD_FAILED.backToLobby}</Button>
                <Button onClick={() => { setLoadingTimeout(false); requestSync(); }} className="bg-cyan-600 hover:bg-cyan-700">{LOAD_FAILED.reconnect}</Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl text-slate-400">{LOADING_TEXT.default}</div>
              {error && <div className="text-red-400 text-sm">{error}<Button variant="link" onClick={clearError}>清除</Button></div>}
            </>
          )}
        </div>
      </div>
    );
  }

  // GameState 有 drawPile/discardPile，ViewState 没有；用 kind 显式判别
  const drawPile = gameState.kind === 'game' ? gameState.drawPile : undefined;
  const discardPile = gameState.kind === 'game' ? gameState.discardPile : undefined;

  const currentPlayer = currentPlayerIndex !== undefined ? players[currentPlayerIndex] : undefined;
  const isHumanTurn = currentPlayer?.id === localPlayerIdFromState;

  if (phase === 'gameOver' && winner) {
    const isHumanWinner = winner === localPlayerIdFromState;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
        <div className="text-center space-y-6">
          <h1 className={`text-5xl font-bold ${isHumanWinner ? 'text-green-400' : 'text-red-400'}`}>
            {isHumanWinner ? <span className="flex items-center justify-center gap-3"><Trophy className="w-12 h-12" /> {GAME_OVER.win}</span> : <span className="flex items-center justify-center gap-3"><Skull className="w-12 h-12" /> {GAME_OVER.lose}</span>}
          </h1>
          <p className="text-slate-400">{isHumanWinner ? GAME_OVER.winDesc : GAME_OVER.loseDesc}</p>
          <Button onClick={handleLeave} className="bg-gradient-to-r from-purple-600 to-cyan-600">{GAME_OVER.backToLobby}</Button>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="h-dvh flex flex-col bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 text-white overflow-hidden">
      {/* ===== 移动端头部（< 768px）：精简信息，次要功能收进"更多"抽屉 ===== */}
      <header className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-slate-950/80 border-b border-slate-800/50 safe-top md:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xs font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-1 truncate">
            <Orbit className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
            <span className="truncate">{HEADER.title}</span>
          </h1>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400 flex-shrink-0">#{roomCode.slice(-4)}</Badge>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${isHumanTurn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'} max-w-[120px] truncate`}>
            <span className="truncate">{isHumanTurn ? HEADER.yourTurn : HEADER.turnBadge(currentPlayer?.name ?? '')}</span>
          </Badge>
          {/* 连接状态小圆点 */}
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} aria-label={isConnected ? '已连接' : '已断开'} />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMoreMenuOpen(true)}
            className="h-9 w-9 p-0 hover:bg-slate-800/60 flex-shrink-0"
            aria-label="更多操作"
          >
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* ===== 桌面端头部（>= 768px）：保持原信息密度 ===== */}
      <header className="hidden md:flex flex-shrink-0 items-center justify-between flex-wrap gap-y-2 px-4 py-2 bg-slate-950/80 border-b border-slate-800/50 safe-top">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2">
            <Orbit className="w-4 h-4 text-purple-400" /> {HEADER.title}
          </h1>
          <Badge variant="outline" className="text-[10px] sm:text-[11px] px-1.5 py-0 border-slate-700 text-slate-400 hidden sm:inline-flex">{roomCode}</Badge>
          <Badge variant="outline" className="text-[10px] sm:text-[11px] px-1.5 py-0 border-slate-700 text-slate-400"><span className="sm:hidden">T</span><span className="hidden sm:inline">回合</span> {totalTurn}</Badge>
          <Badge className={`text-[10px] sm:text-[11px] px-1.5 py-0 border-0 ${isHumanTurn ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
            {isHumanTurn ? HEADER.yourTurn : HEADER.turnBadge(currentPlayer?.name ?? '')}
          </Badge>
        </div>
        {/* 改造 3: 牌堆/弃牌/飞行中计数在移动端隐藏(关键信息已通过右侧栏折叠兜底块呈现) */}
        {!isMobile && (
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            {gameState.kind === 'game' && (
              <>
                <span className="flex items-center gap-1"><Layers className="w-3 h-3" /> 牌堆: {drawPile?.length || 0}</span>
                <span className="flex items-center gap-1"><Trash2 className="w-3 h-3" /> 弃牌: {discardPile?.length || 0}</span>
              </>
            )}
            {flyingStrikes.length > 0 && <span className="text-red-400 flex items-center gap-1"><Zap className="w-3 h-3" /> 飞行中: {flyingStrikes.length}</span>}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-md p-0.5" role="group" aria-label="玩家状态栏显示模式">
                {PANEL_MODE_ORDER.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPanelMode(m)}
                    className={`min-h-[28px] px-1.5 py-1 text-[10px] rounded transition-colors ${panelMode === m ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    aria-pressed={panelMode === m}
                  >
                    {PANEL_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px]">{HEADER.panelModeTooltip}</TooltipContent>
          </Tooltip>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${isConnected ? 'border-green-500 text-green-400' : 'border-red-500 text-red-400'}`}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          </Badge>
          <GameRulesButton
            compact
            label={HEADER.rulesQuick}
            onClick={() => setShowRulesPanel(true)}
            className="hover:bg-slate-800/60 hover:text-cyan-300"
          />
          <GameRulesPanel
            variant="compact"
            gameMode={gameState.gameMode}
            modeRules={gameState.modeRules}
            visible={showRulesPanel}
            onClose={() => setShowRulesPanel(false)}
          />
          <Button variant="ghost" size="sm" onClick={handleLeave} className="h-8 w-8 p-0 hover:bg-red-950/30 hover:text-red-400"><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>

      {/* ===== 移动端"更多"抽屉：从右侧滑入，收纳 panel mode/规则/计数/退出 ===== */}
      {moreMenuOpen && (
        <>
          {/* 半透明遮罩 */}
          <div
            className="fixed inset-0 bg-black/60 z-drawer md:hidden"
            onClick={() => setMoreMenuOpen(false)}
            aria-hidden
          />
          {/* 抽屉主体 */}
          <div
            className="fixed top-0 right-0 bottom-0 w-[280px] max-w-[80vw] bg-slate-950 border-l border-slate-800 z-drawer md:hidden flex flex-col safe-top safe-bottom animate-fade-in"
            role="dialog"
            aria-label="更多操作"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-bold text-slate-300">更多操作</span>
              <Button variant="ghost" size="icon" onClick={() => setMoreMenuOpen(false)} className="h-8 w-8 p-0 hover:bg-slate-800/60" aria-label="关闭">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 房间码 + 回合数 */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">对局信息</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">房间码</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">{roomCode}</Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">回合数</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">{totalTurn}</Badge>
                </div>
                {gameState.kind === 'game' && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1"><Layers className="w-3 h-3" /> 牌堆</span>
                      <span className="text-slate-300">{drawPile?.length || 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 flex items-center gap-1"><Trash2 className="w-3 h-3" /> 弃牌</span>
                      <span className="text-slate-300">{discardPile?.length || 0}</span>
                    </div>
                  </>
                )}
                {flyingStrikes.length > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400 flex items-center gap-1"><Zap className="w-3 h-3" /> 飞行中</span>
                    <span className="text-red-300">{flyingStrikes.length}</span>
                  </div>
                )}
              </div>

              {/* 飞行中打击列表 */}
              <FlyingStrikesList />

              {/* 玩家状态栏模式 */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">状态栏模式</div>
                <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-md p-0.5" role="group" aria-label="玩家状态栏显示模式">
                  {PANEL_MODE_ORDER.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPanelMode(m)}
                      className={`flex-1 min-h-[36px] px-2 py-1.5 text-xs rounded transition-colors ${panelMode === m ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      aria-pressed={panelMode === m}
                    >
                      {PANEL_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 门牌展示方式（仅移动端生效，桌面端保持垂直堆叠） */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  门牌展示方式
                  <span className="text-[9px] text-slate-600 normal-case tracking-normal">移动端</span>
                </div>
                <div className="flex items-center gap-0.5 bg-slate-800/50 rounded-md p-0.5" role="group" aria-label="移动端场上门牌展示方式">
                  {DOOR_CARD_MODE_ORDER.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setDoorCardMode(m); setMoreMenuOpen(false); }}
                      className={`flex-1 min-h-[36px] px-2 py-1.5 text-xs rounded transition-colors ${doorCardMode === m ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      aria-pressed={doorCardMode === m}
                    >
                      {DOOR_CARD_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 规则入口 */}
              <Button
                variant="outline"
                className="w-full h-11 justify-start"
                onClick={() => { setShowRulesPanel(true); setMoreMenuOpen(false); }}
              >
                <BookOpen className="w-4 h-4 mr-2" />
                {HEADER.rulesQuick}
              </Button>
              <GameRulesPanel
                variant="compact"
                gameMode={gameState.gameMode}
                modeRules={gameState.modeRules}
                visible={showRulesPanel}
                onClose={() => setShowRulesPanel(false)}
              />
            </div>
            {/* 底部退出按钮 */}
            <div className="p-4 border-t border-slate-800 safe-bottom">
              <Button
                variant="outline"
                className="w-full h-11 border-red-900/50 text-red-400 hover:bg-red-950/30 hover:text-red-300"
                onClick={handleLeave}
              >
                <LogOut className="w-4 h-4 mr-2" />
                退出对局
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ===== 子头部：桌面端显示完整信息，移动端仅显示阶段 + pendingAction ===== */}
      <div className="flex-shrink-0 px-4 py-1 bg-slate-900/50 border-b border-slate-800/30">
        <div className="flex items-center gap-2 max-md:gap-2 max-md:flex-wrap">
          <span className="text-xs text-slate-400 flex items-center gap-1">{turnPhase ? TURN_PHASE_ICONS[turnPhase] : null}{turnPhase ? TURN_PHASE_LABELS[turnPhase] || turnPhase : null}</span>
          {!!pendingAction && <Badge variant="destructive" className="text-[9px] px-1.5 py-0">{HEADER.pendingAction}</Badge>}
          {/* 移动端隐藏能量/位置/手牌数（移至 OnlinePlayerHand 顶部显示，节省垂直空间） */}
          {humanPlayer && !humanPlayer.eliminated && (
            <div className="hidden md:flex items-center gap-1 ml-auto">
              <span className="text-xs text-yellow-500 flex items-center gap-1"><Zap className="w-3 h-3" /> {humanPlayer.energy}</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-xs text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> 星系 {humanPlayer.position}</span>
              <span className="text-xs text-slate-500">|</span>
              <span className="text-xs text-slate-400 flex items-center gap-1"><Layers className="w-3 h-3" /> {humanPlayer.hand?.length ?? 0}</span>
            </div>
          )}
        </div>
      </div>

      {/* 悬停打击警告：当前玩家所在星系有待生效打击（P2-2 Task 4: 提取为 StrikeWarningBar 子组件） */}
      <StrikeWarningBar />

      <div className="flex-1 flex min-h-0">
        {/* 改造 4: 左侧栏在 lg(1024-1279px) 缩到 44(176px),给中央栏让出 16px,xl+ 恢复 48(192px) */}
        <div className="w-48 lg:w-44 xl:w-48 flex-shrink-0 p-2 overflow-y-auto hidden lg:block"><OnlineOpponentsPanel onPositionClick={handlePositionClick} markingPlayerId={markingMode?.playerId ?? null} /></div>
        <div className="flex-1 flex flex-col min-w-0 min-h-0 p-2 gap-2">
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
            <div className="h-full w-full max-w-2xl"><OnlineStarMap markingMode={markingMode} onExitMarkingMode={handleExitMarkingMode} /></div>
          </div>
          <div className="flex-shrink-0"><OnlineGameLog /></div>
          <div className="flex-shrink-0 lg:hidden"><OnlineOpponentsPanel onPositionClick={handlePositionClick} markingPlayerId={markingMode?.playerId ?? null} /></div>
          {/* 改造 2: 右侧栏兜底 — 平板端保留 <details> 折叠;手机端整体不再渲染 */}
          {!isMobile && (
          <div className="flex-shrink-0 xl:hidden">
            <details className="bg-slate-900/50 border border-slate-800 rounded-lg">
              <summary className="text-xs font-bold text-slate-400 px-3 py-1.5 cursor-pointer flex items-center gap-1.5 list-none">
                <BookOpen className="w-3.5 h-3.5" /> {QUICK_REF.title}
              </summary>
              <div className="px-2 pb-2 space-y-2">
                {renderQuickRef()}
              </div>
            </details>
          </div>
          )}
        </div>
        {/* 桌面端右侧栏: 仅 xl+ 显示,内容复用 FlyingStrikesList / renderQuickRef */}
        <div className="w-48 flex-shrink-0 p-2 space-y-2 overflow-y-auto hidden xl:block">
          <FlyingStrikesList />
          {renderQuickRef()}
        </div>
      </div>

      {humanPlayer && !humanPlayer.eliminated && (
        <div className="flex-shrink-0 bg-slate-950/80 border-t border-slate-800/50 safe-bottom"><OnlinePlayerHand /></div>
      )}

      {humanPlayer?.eliminated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 pointer-events-none">
          <div className="text-center">
            <Skull className="w-16 h-16 mx-auto text-red-400" />
            <p className="text-xl font-bold text-red-400 mt-3">{ELIMINATED.title}</p>
            <p className="text-sm text-slate-500 mt-1">{ELIMINATED.desc}</p>
          </div>
        </div>
      )}

      <OnlineNotepad />
      <OnlineMarkerManager />
      <Toaster />
      {/* P1-2: Dialog 懒挂载 — 4 个打击 Dialog 仅在 pendingAction.type 匹配时挂载，
          避免关闭后仍常驻 React 元素树（每个 Dialog 内含 OnlineStarMap）。
          各 Dialog 组件内部已对 type 二次窄化，外层条件渲染仅做粗粒度过滤以减少元素创建。 */}
      {pendingAction?.type === 'strikeSelect' && <OnlineStrikeSelectDialog />}
      {pendingAction?.type === 'strikeMove' && <OnlineStrikeMoveDialog />}
      {pendingAction?.type === 'announceStrike' && <OnlineAnnounceStrikeDialog />}
      {(pendingAction?.type === 'strikeMissedFree' || pendingAction?.type === 'strikeMissedRequireTarget') && <OnlineStrikeMissedDialog />}
      <OnlineRelicRevealDialog />
      <OnlineBroadcastResponsePanel isOpen={broadcastResponsePanelOpen} onClose={handleCloseBroadcastResponse} />
      <OnlineBroadcastSelectResponderPanel isOpen={broadcastSelectPanelOpen} onClose={handleCloseBroadcastSelect} />
    </div>
    </TooltipProvider>
  );
});

OnlineBoard.displayName = 'OnlineBoard';
