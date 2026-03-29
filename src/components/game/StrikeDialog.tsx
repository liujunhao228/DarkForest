'use client';

import { useGameStore } from '@/store/gameStore';
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
import { StarMap } from './StarMap';

/** Strike movement dialog */
export function StrikeMoveDialog() {
  const pendingAction = useGameStore(s => s.pendingAction);
  const flyingStrikes = useGameStore(s => s.flyingStrikes);
  const moveStrikeTo = useGameStore(s => s.moveStrikeTo);
  const players = useGameStore(s => s.players);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);

  if (pendingAction?.type !== 'strikeMove') return null;

  const strike = flyingStrikes.find(s => s.uid === pendingAction.strikeUid);
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
          <StarMap
            strikeMoveTargets={pendingAction.validMoves}
            onSystemClick={(systemId) => moveStrikeTo(strike.uid, systemId)}
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

/** Announce strike dialog */
export function AnnounceStrikeDialog() {
  const pendingAction = useGameStore(s => s.pendingAction);
  const flyingStrikes = useGameStore(s => s.flyingStrikes);
  const players = useGameStore(s => s.players);
  const doAnnounceStrike = useGameStore(s => s.doAnnounceStrike);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);

  if (pendingAction?.type !== 'announceStrike') return null;

  const strike = flyingStrikes.find(s => s.uid === pendingAction.strikeUid);
  if (!strike) return null;

  const isHuman = strike.ownerId === humanPlayerId;
  const targetPlayers = players.filter(p => pendingAction.targetPlayerIds.includes(p.id) && !p.eliminated);

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
          <Button onClick={doAnnounceStrike} className="bg-red-600 hover:bg-red-500 text-white">
            ⚡ 宣布生效
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
