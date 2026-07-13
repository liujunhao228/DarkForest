import { useState, useEffect, useRef } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { OnlineStarMap } from './OnlineStarMap';
import type { PendingAction, Card, FlyingStrike } from '@/lib/game/types';
import type { FlyingStrikeView } from '@/lib/game/viewState';
import { Zap, Crosshair, Clock, Target, SkipForward, X } from 'lucide-react';

// 类型守卫：从 unknown 中提取 PendingAction
function isPendingAction(a: unknown): a is PendingAction {
  return typeof a === 'object' && a !== null && 'type' in a;
}

// FlyingStrike 与 FlyingStrikeView 的同构字段联合（字段结构兼容）
type AnyStrike = FlyingStrike | FlyingStrikeView;

// OnlineStrikeSelectDialog: 多打击选择列表
export function OnlineStrikeSelectDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const localPlayerId = useLocalPlayerId();

  if (!gameState) return null;

  const pendingAction = gameState.pendingAction;
  if (!isPendingAction(pendingAction) || pendingAction.type !== 'strikeSelect') return null;

  const flyingStrikes = gameState.flyingStrikes as readonly AnyStrike[] | undefined;
  const localPlayerIdFromState = localPlayerId || gameState.localPlayerId;

  const strikes = (flyingStrikes || []).filter(s => pendingAction.strikeUids.includes(s.uid));
  // 只在当前玩家回合显示
  if (gameState.currentPlayerId !== localPlayerIdFromState) return null;

  // 是否存在已 Arrived 打击（有则不允许跳过）
  const hasArrivedStrike = strikes.some(s => s.arrived);

  return (
    <Dialog open={true}>
      <DialogContent className="bg-slate-900 border-red-900/50 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-red-400 flex items-center gap-2"><Zap className="w-5 h-5" /> 选择打击操作</DialogTitle>
          <DialogDescription className="text-slate-400">你有 {strikes.length} 个打击待处理，请选择一个进行操作</DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-2 max-h-[50vh] overflow-y-auto">
          {strikes.map(strike => {
            const isArrived = strike.arrived;
            return (
              <button
                key={strike.uid}
                onClick={() => sendAction('selectStrike', { strikeUid: strike.uid })}
                className="w-full flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg border border-slate-700 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                  {isArrived ? <Crosshair className="w-4 h-4 text-red-400" /> : <Zap className="w-4 h-4 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white truncate">{strike.strikeName}</span>
                    <span className="text-xs text-red-400">Lv.{strike.level}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {isArrived ? (
                      <span className="text-amber-400">已到达星系 {strike.targetSystem}，可宣布生效</span>
                    ) : (
                      <span>位置 {strike.position} → 目标 {strike.targetSystem}（剩余移动 {strike.remainingMoves}）</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-cyan-400 flex-shrink-0">操作 →</span>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          {!hasArrivedStrike && (
            <Button variant="outline" onClick={() => sendAction('skipStrikeSelect', {})} className="text-slate-400">
              <SkipForward className="w-4 h-4 mr-1" /> 跳过移动
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// OnlineStrikeMoveDialog: 打击移动（可关闭，支持重新指定目标）
export function OnlineStrikeMoveDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const localPlayerId = useLocalPlayerId();

  const [open, setOpen] = useState(true);
  const [retargetMode, setRetargetMode] = useState(false);

  // 提前计算依赖，确保 hooks 顺序稳定
  const pendingAction = gameState?.pendingAction;
  const isStrikeMove = isPendingAction(pendingAction) && pendingAction.type === 'strikeMove';
  const strikeUid = isStrikeMove ? pendingAction.strikeUid : null;

  // 监听 strikeUid 变化重置弹窗（render-phase 衍生状态，避免 effect 中同步 setState）
  const prevStrikeUidRef = useRef<string | null>(null);
  if (prevStrikeUidRef.current !== strikeUid) {
    prevStrikeUidRef.current = strikeUid;
    if (strikeUid) {
      setOpen(true);
      setRetargetMode(false);
    }
  }

  // 监听重新打开事件
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('reopen-strike-move-dialog', handler);
    return () => window.removeEventListener('reopen-strike-move-dialog', handler);
  }, []);

  if (!gameState || !isStrikeMove || !strikeUid || !pendingAction || pendingAction.type !== 'strikeMove') return null;

  const flyingStrikes = gameState.flyingStrikes as readonly AnyStrike[] | undefined;
  const localPlayerIdFromState = localPlayerId || gameState.localPlayerId;
  const strike = (flyingStrikes || []).find(s => s.uid === strikeUid);
  if (!strike) return null;
  if (strike.ownerId !== localPlayerIdFromState) return null;

  const handleMove = (systemId: number) => {
    sendAction('moveStrike', { strikeUid: strike.uid, targetSystem: systemId });
    setOpen(false);
  };

  const handleRetarget = (systemId: number) => {
    sendAction('retargetStrike', { strikeUid: strike.uid, targetSystem: systemId });
    setRetargetMode(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-slate-900 border-red-900/50 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-red-400 flex items-center gap-2">
            <Zap className="w-5 h-5" /> {retargetMode ? '重新指定打击目标' : '打击牌移动'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            {retargetMode ? (
              <>选择新的目标星系，打击将重置目标并继续飞行</>
            ) : (
              <><span className="text-white font-bold">{strike.strikeName}</span>（等级 {strike.level}）正在飞向星系 {strike.targetSystem}，当前位置：星系 {strike.position}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <p className="text-xs text-slate-400 mb-3">
            {retargetMode ? '点击任意星系作为新目标：' : '点击相邻星系选择移动方向：'}
          </p>
          <OnlineStarMap
            highlightSystems={retargetMode ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : []}
            strikeMoveTargets={!retargetMode && strike.remainingMoves > 0 ? pendingAction.validMoves : []}
            onSystemClick={retargetMode ? handleRetarget : handleMove}
            interactiveMode
          />
        </div>

        <DialogFooter className="flex items-center gap-2">
          {!retargetMode && (
            <>
              <div className="flex items-center gap-2 text-xs text-slate-500 mr-auto">
                <span>目标: 星系 {strike.targetSystem}</span><span>|</span>
                <span>速度: {strike.speed}/回合</span><span>|</span>
                <span>剩余移动: {strike.remainingMoves}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRetargetMode(true)} className="text-amber-400 border-amber-700/50">
                <Target className="w-4 h-4 mr-1" /> 重新指定目标
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-slate-400">
                <X className="w-4 h-4 mr-1" /> 关闭
              </Button>
            </>
          )}
          {retargetMode && (
            <Button variant="ghost" size="sm" onClick={() => setRetargetMode(false)} className="text-slate-400">
              返回移动
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// OnlineAnnounceStrikeDialog: 宣布打击生效（显示防御牌名）
export function OnlineAnnounceStrikeDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const localPlayerId = useLocalPlayerId();

  if (!gameState) return null;

  const pendingAction = gameState.pendingAction;
  if (!isPendingAction(pendingAction) || pendingAction.type !== 'announceStrike') return null;

  const flyingStrikes = gameState.flyingStrikes as readonly AnyStrike[] | undefined;
  const localPlayerIdFromState = localPlayerId || gameState.localPlayerId;
  const strike = (flyingStrikes || []).find(s => s.uid === pendingAction.strikeUid);
  if (!strike) return null;

  const targetPlayers = gameState.players?.filter(p => pendingAction.targetPlayerIds?.includes(p.id) && !p.eliminated) || [];

  if (strike.ownerId !== localPlayerIdFromState) return null;

  return (
    <Dialog open={true}>
      <DialogContent className="bg-slate-900 border-red-900/50 text-white">
        <DialogHeader>
          <DialogTitle className="text-red-400 flex items-center gap-2"><Crosshair className="w-5 h-5" /> 宣布打击生效</DialogTitle>
          <DialogDescription className="text-slate-400">
            <span className="text-white font-bold">{strike.strikeName}</span> 已到达星系 {strike.targetSystem}！
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs text-slate-400">目标玩家：</p>
          {targetPlayers.length === 0 ? (
            <div className="text-xs text-slate-500 p-2 bg-slate-800/30 rounded">无目标玩家在星系 {strike.targetSystem}，打击可宣布落空或延迟</div>
          ) : (
            targetPlayers.map(p => (
              <div key={p.id} className="flex items-center gap-2 p-2 bg-red-950/30 rounded border border-red-900/30">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-sm font-bold text-red-300">{p.name}</span>
                <span className="text-xs text-slate-500">
                  防御：{p.faceUpCards?.filter((c: Card) => c.type === 'defense').map((c: Card) => c.name).join(', ') || '无'}
                </span>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => sendAction('skipAnnounceStrike', { strikeUid: strike.uid })} className="text-slate-400">
            <Clock className="w-4 h-4 mr-1" /> 延迟宣布
          </Button>
          <Button onClick={() => sendAction('announceStrike', { strikeUid: strike.uid })} className="bg-red-600 hover:bg-red-500 text-white">
            <Zap className="w-4 h-4 mr-1" /> 宣布生效
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
