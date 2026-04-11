'use client';

import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { OnlineStarMap } from './OnlineStarMap';
import type { PendingAction } from '@/lib/game/types';
import { Zap, Crosshair, Clock } from 'lucide-react';

/** Online Strike Movement Dialog */
export function OnlineStrikeMoveDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);

  if (!gameState) return null;

  const { pendingAction, flyingStrikes, players } = gameState;

  // 使用自定义 hook 获取本地玩家 ID
  const localPlayerId = useLocalPlayerId();
  const humanPlayerId = localPlayerId || gameState.humanPlayerId;

  // 类型守卫：检查 pendingAction 是否是 strikeMove
  const action = pendingAction as PendingAction | null;
  if (!action || action.type !== 'strikeMove') return null;

  const strike = flyingStrikes.find(s => s.uid === action.strikeUid);
  if (!strike) return null;

  const owner = players.find(p => p.id === strike.ownerId);
  const isHuman = strike.ownerId === humanPlayerId;

  if (!isHuman) return null;

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="bg-slate-900 border-red-900/50 text-white max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-400">
            <span className="flex items-center gap-2"><Zap className="w-5 h-5" /> 打击牌移动</span>
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            <span className="text-white font-bold">{strike.strikeName}</span> (等级 {strike.level})
            正在飞向星系 {strike.targetSystem}，当前位置: 星系 {strike.position}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <p className="text-xs text-slate-400 mb-3">点击相邻星系选择移动方向：</p>
          <OnlineStarMap
            strikeMoveTargets={action.validMoves}
            onSystemClick={(systemId) => sendAction('moveStrike', { strikeUid: strike.uid, targetSystem: systemId })}
            interactiveMode
          />
        </div>

        <AlertDialogFooter>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>目标: 星系 {strike.targetSystem}</span>
            <span>|</span>
            <span>速度: {strike.speed}/回合</span>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Online Announce Strike Dialog */
export function OnlineAnnounceStrikeDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);

  if (!gameState) return null;

  const { pendingAction, flyingStrikes, players } = gameState;

  // 使用自定义 hook 获取本地玩家 ID
  const localPlayerId = useLocalPlayerId();
  const humanPlayerId = localPlayerId || gameState.humanPlayerId;

  // 类型守卫：检查 pendingAction 是否是 announceStrike
  const action = pendingAction as PendingAction | null;
  if (!action || action.type !== 'announceStrike') return null;

  const strike = flyingStrikes.find(s => s.uid === action.strikeUid);
  if (!strike) return null;

  const isHuman = strike.ownerId === humanPlayerId;
  const targetPlayers = players.filter(p => action.targetPlayerIds.includes(p.id) && !p.eliminated);

  if (!isHuman) return null;

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="bg-slate-900 border-red-900/50 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-400">
            <span className="flex items-center gap-2"><Crosshair className="w-5 h-5" /> 宣布打击生效</span>
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            <span className="text-white font-bold">{strike.strikeName}</span> 已到达星系 {strike.targetSystem}！
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <p className="text-xs text-slate-400">目标玩家：</p>
          {targetPlayers.map(p => (
            <div key={p.id} className="flex items-center gap-2 p-2 bg-red-950/30 rounded border border-red-900/30">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-sm font-bold text-red-300">{p.name}</span>
              <span className="text-xs text-slate-500">
                防御: {p.faceUpCards.filter(c => c.type === 'defense').map(c => c.name).join(', ') || '无'}
              </span>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <Button 
            variant="outline" 
            onClick={() => sendAction('skipAnnounceStrike', { strikeUid: strike.uid })}
            className="text-slate-400"
          >
            <Clock className="w-4 h-4 mr-1" /> 延迟宣布
          </Button>
          <Button onClick={() => sendAction('announceStrike', { strikeUid: strike.uid })} className="bg-red-600 hover:bg-red-500 text-white">
            <Zap className="w-4 h-4 mr-1" /> 宣布生效
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
