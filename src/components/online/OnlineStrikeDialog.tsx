'use client';

import { useOnlineGameStore } from '@/store/onlineGameStore';
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
import { useMemo } from 'react';
import type { PendingAction } from '@/lib/game/types';

/** Online Strike Movement Dialog */
export function OnlineStrikeMoveDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);

  if (!gameState) return null;

  const { pendingAction, flyingStrikes, players } = gameState;

  // 从本地存储获取当前登录玩家的 ID（每个客户端自己的身份）
  const localPlayerId = useMemo(() => {
    try {
      const playerData = localStorage.getItem('player');
      if (playerData) {
        return JSON.parse(playerData).id;
      }
    } catch {}
    return null;
  }, []);

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
            💥 打击牌移动
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

  // 从本地存储获取当前登录玩家的 ID（每个客户端自己的身份）
  const localPlayerId = useMemo(() => {
    try {
      const playerData = localStorage.getItem('player');
      if (playerData) {
        return JSON.parse(playerData).id;
      }
    } catch {}
    return null;
  }, []);

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
            🎯 宣布打击生效
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
          <Button onClick={() => sendAction('announceStrike', { strikeUid: strike.uid })} className="bg-red-600 hover:bg-red-500 text-white">
            ⚡ 宣布生效
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
