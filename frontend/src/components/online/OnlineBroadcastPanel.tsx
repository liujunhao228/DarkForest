import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GameCard } from '@/components/game/GameCard';
import { Radio, Ban, X, ChevronRight, Users, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Card, BroadcastResponse } from '@/lib/game/types';

/**
 * 广播面板定位：
 * - 桌面端：右侧居中固定 320px 宽，z-overlay（30）
 * - 移动端：底部上推 sheet，z-drawer（40），覆盖手牌区
 *
 * z-index 分层参考 index.css：z-content(10) < z-header(20) < z-overlay(30) < z-drawer(40) < z-dialog(50)
 * 手牌区为 z-content，BroadcastPanel 移动端 z-drawer 高于手牌区，避免视觉重叠。
 */
const panelPositionClass = (isMobile: boolean) =>
  isMobile
    ? 'fixed inset-x-0 bottom-0 top-auto z-drawer max-h-[60vh] overflow-y-auto rounded-t-xl safe-bottom'
    : 'fixed right-4 top-1/2 -translate-y-1/2 z-overlay w-80';

/**
 * 广播面板进入/退出动画：
 * - 桌面端：从右侧滑入 + 轻微缩放
 * - 移动端：从底部上推（sheet 风格）
 */
const panelMotionProps = (isMobile: boolean) =>
  isMobile
    ? { initial: { opacity: 0, y: '100%' }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: '100%' }, transition: { duration: 0.25, ease: 'easeOut' as const } }
    : { initial: { opacity: 0, x: 100, scale: 0.95 }, animate: { opacity: 1, x: 0, scale: 1 }, exit: { opacity: 0, x: 100, scale: 0.95 }, transition: { duration: 0.25, ease: 'easeOut' as const } };

interface OnlineBroadcastResponsePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnlineBroadcastResponsePanel({ isOpen, onClose }: OnlineBroadcastResponsePanelProps) {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const localPlayerId = useLocalPlayerId();
  const isMobile = useIsMobile();

  // 在线模式专用组件：仅 ViewState
  if (!gameState || gameState.kind !== 'view') return null;

  const { broadcast, players, localPlayerId: serverLocalPlayerId } = gameState;
  const localPlayerIdFromState = localPlayerId || serverLocalPlayerId;

  if (!broadcast) return null;

  const responses = broadcast.responses;
  const humanResponse = responses?.find((r) => r.playerId === localPlayerIdFromState);
  if (!humanResponse || !humanResponse.canRespond || humanResponse.responded) return null;

  const broadcaster = players?.find(p => p.id === broadcast.broadcasterId);
  const humanPlayer = players?.find(p => p.id === localPlayerIdFromState);
  const broadcastCards = (humanPlayer?.hand || []).filter((c: Card) => c.type === 'broadcast' && (humanPlayer?.energy ?? 0) >= c.energy);

  const handleRespond = (agreed: boolean, cardUid?: string) => {
    sendAction('respondBroadcast', { agreed, cardUid });
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0, x: 100, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 100, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }} className={panelPositionClass(isMobile)}>
          <div className="bg-slate-900/95 backdrop-blur-sm border border-emerald-900/50 rounded-xl shadow-2xl shadow-emerald-900/20 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 px-4 py-3 border-b border-emerald-900/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400"><Radio className="w-4 h-4" /><span className="font-bold text-sm">收到广播信号</span></div>
                <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800"><X className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <div className="text-sm text-slate-300">
                <span className="text-white font-bold">{broadcaster?.name}</span> 向星系{' '}
                <Badge variant="outline" className="text-cyan-400 border-cyan-400/50 text-xs mx-1">{broadcast.targetSystem}</Badge> 发送了广播信号
                {humanResponse.mustRespond && <div className="text-red-400 font-bold mt-1 flex items-center gap-1"><Sparkles className="w-3 h-3" />你在该星系，必须回应！</div>}
              </div>

              <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                <div className="text-xs text-slate-400 flex items-center gap-1"><Users className="w-3 h-3" />广播范围: {broadcast.range} 格</div>
                <div className="text-xs text-slate-400 flex items-center gap-1"><Radio className="w-3 h-3" />类型: {broadcast.subtype === 'cooperation' ? '合作' : broadcast.subtype === 'disguise' ? '伪装' : '未知'}</div>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-slate-400">选择回应方式：</p>
                {broadcastCards.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">使用广播牌回应：</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {broadcastCards.map((card: Card) => (
                        <div key={card.uid} className="flex-shrink-0 cursor-pointer transition-transform duration-200 hover:scale-105 hover:ring-2 hover:ring-emerald-500/50 rounded-lg"
                          onClick={() => handleRespond(true, card.uid)} role="button" aria-label={`使用 ${card.name} 回应广播`} tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRespond(true, card.uid); } }}>
                          <GameCard card={card} compact selected={false} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!humanResponse.mustRespond && (
                  <Button variant="ghost" className="w-full text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 border border-slate-700/50" onClick={() => handleRespond(false)}>
                    <Ban className="w-4 h-4 mr-2" />不回应
                  </Button>
                )}
              </div>
            </div>

            <div className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/30">
              <p className="text-[11px] text-slate-500 text-center">点击卡片选择回应方式</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface OnlineBroadcastSelectResponderPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function OnlineBroadcastSelectResponderPanel({ isOpen, onClose }: OnlineBroadcastSelectResponderPanelProps) {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const localPlayerId = useLocalPlayerId();
  const isMobile = useIsMobile();

  // 在线模式专用组件：仅 ViewState
  if (!gameState || gameState.kind !== 'view') return null;

  const { broadcast, players, localPlayerId: serverLocalPlayerId } = gameState;
  const localPlayerIdFromState = localPlayerId || serverLocalPlayerId;

  if (!broadcast) return null;
  if (broadcast.broadcasterId !== localPlayerIdFromState) return null;

  const responses = broadcast.responses;
  const humanResponders = responses?.filter((r) => r.canRespond && !r.responded) || [];
  const respondedPlayers = responses?.filter((r) => r.responded && r.agreed) || [];

  if (humanResponders.length > 0) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div {...panelMotionProps(isMobile)} className={panelPositionClass(isMobile)}>
            <div className="bg-slate-900/95 backdrop-blur-sm border border-amber-900/50 rounded-xl shadow-2xl shadow-amber-900/20 overflow-hidden">
              <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/30 px-4 py-3 border-b border-amber-900/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-400"><Radio className="w-4 h-4" /><span className="font-bold text-sm">等待回应</span></div>
                  <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800"><X className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-slate-300">等待其他玩家回应你的广播...</p>
                <div className="space-y-1">
                  {humanResponders.map((r: BroadcastResponse) => (
                    <div key={r.playerId} className="text-sm text-slate-400 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />{r.playerName} 需要回应
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/30">
                <Button variant="outline" size="sm" className="w-full border-red-500/50 text-red-400 hover:bg-red-950/30" onClick={() => { sendAction('cancelBroadcast', {}); onClose(); }}>
                  取消广播
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (broadcast.selectedResponderId) {
    const selectedPlayer = players?.find(p => p.id === broadcast.selectedResponderId);
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div {...panelMotionProps(isMobile)} className={panelPositionClass(isMobile)}>
            <div className="bg-slate-900/95 backdrop-blur-sm border border-emerald-900/50 rounded-xl shadow-2xl shadow-emerald-900/20 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 px-4 py-3 border-b border-emerald-900/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400"><Radio className="w-4 h-4" /><span className="font-bold text-sm">已选择回应者</span></div>
                  <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800"><X className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-slate-300">你选择了 <span className="text-emerald-400 font-bold">{selectedPlayer?.name}</span> 的回应</p>
                <div className="bg-slate-800/50 rounded-lg p-3"><p className="text-sm text-slate-400">正在揭示双方卡牌，等待结算...</p></div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (respondedPlayers.length === 0) {
    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div {...panelMotionProps(isMobile)} className={panelPositionClass(isMobile)}>
            <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700/50 rounded-xl shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-400"><Radio className="w-4 h-4" /><span className="font-bold text-sm">无人回应</span></div>
                  <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800"><X className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="p-4 space-y-3"><p className="text-sm text-slate-500">没有玩家回应你的广播，你将获得 1 点能量。</p></div>
              <div className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/30">
                <Button onClick={onClose} className="w-full bg-slate-700 hover:bg-slate-600 text-white">确定</Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0, x: 100, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 100, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }} className={panelPositionClass(isMobile)}>
          <div className="bg-slate-900/95 backdrop-blur-sm border border-emerald-900/50 rounded-xl shadow-2xl shadow-emerald-900/20 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 px-4 py-3 border-b border-emerald-900/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400"><Radio className="w-4 h-4" /><span className="font-bold text-sm">选择回应者</span></div>
                <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800"><X className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
              {respondedPlayers.map((r) => {
                const responder = players?.find(p => p.id === r.playerId);
                return (
                  <Button key={r.playerId} variant="outline" className="w-full justify-start bg-slate-800/50 border-slate-700/50 hover:bg-slate-700/50 text-white"
                    onClick={() => { sendAction('selectBroadcastResponder', { responderId: r.playerId }); onClose(); }}>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" /><span className="font-bold">{responder?.name}</span>
                      {r.responseCard && <Badge className="text-[9px] border-0 bg-emerald-500/20 text-emerald-300">{r.responseCard.name} ({r.responseCard.subtype === 'cooperation' ? '合作' : '伪装'})</Badge>}
                    </div>
                    <ChevronRight className="w-4 h-4 ml-auto text-slate-500" />
                  </Button>
                );
              })}
            </div>

            <div className="px-4 py-3 bg-slate-800/30 border-t border-slate-700/30">
              <Button variant="outline" size="sm" className="w-full border-red-500/50 text-red-400 hover:bg-red-950/30" onClick={() => { sendAction('cancelBroadcast', {}); onClose(); }}>
                取消广播
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
