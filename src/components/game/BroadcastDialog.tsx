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
import { GameCard } from './GameCard';

/** Broadcast response dialog (for the human player when they need to respond to a broadcast) */
export function BroadcastResponseDialog() {
  const broadcast = useGameStore(s => s.broadcast);
  const pendingAction = useGameStore(s => s.pendingAction);
  const players = useGameStore(s => s.players);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);
  const doRespondToBroadcast = useGameStore(s => s.doRespondToBroadcast);

  if (!broadcast || !broadcast.active) return null;

  // Check if human player needs to respond
  const humanResponse = broadcast.responses.find(r => r.playerId === humanPlayerId);
  if (!humanResponse || !humanResponse.canRespond || humanResponse.responded) return null;

  const broadcaster = players.find(p => p.id === broadcast.broadcasterId);
  const humanPlayer = players.find(p => p.id === humanPlayerId);
  const broadcastCards = humanPlayer?.hand.filter(c => c.type === 'broadcast' && humanPlayer.energy >= c.energy) || [];

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="bg-slate-900 border-emerald-900/50 text-white max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-emerald-400">
            📡 收到广播信号
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            <span className="text-white font-bold">{broadcaster?.name}</span>
            向星系 {broadcast.targetSystem} 发送了广播信号
            {humanResponse.mustRespond && (
              <span className="text-red-400 font-bold ml-2">（你在该星系，必须回应！）</span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-slate-400">选择回应方式：</p>

          {/* Respond with card */}
          {broadcastCards.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">选择一张广播牌回应：</p>
              <div className="flex gap-2 flex-wrap">
                {broadcastCards.map(card => (
                  <div key={card.uid} className="cursor-pointer" onClick={() => doRespondToBroadcast(humanPlayerId, true, card.uid)}>
                    <GameCard card={card} compact selected={false} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decline (if not mandatory) */}
          {!humanResponse.mustRespond && (
            <Button
              variant="ghost"
              className="w-full text-slate-400 hover:text-slate-300"
              onClick={() => doRespondToBroadcast(humanPlayerId, false)}
            >
              🚫 不回应
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Broadcast select responder dialog (for the human player as broadcaster) */
export function BroadcastSelectResponderDialog() {
  const broadcast = useGameStore(s => s.broadcast);
  const players = useGameStore(s => s.players);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);
  const doSelectBroadcastResponder = useGameStore(s => s.doSelectBroadcastResponder);
  const doCancelBroadcast = useGameStore(s => s.doCancelBroadcast);

  if (!broadcast || !broadcast.active) return null;
  if (broadcast.broadcasterId !== humanPlayerId) return null;

  // 检查是否所有回应都已收到
  const allResponded = broadcast.responses.every(r => r.responded);

  // 如果有人类需要回应但还未回应，显示等待提示
  const humanResponders = broadcast.responses.filter(r => r.canRespond && !r.responded);

  if (humanResponders.length > 0) {
    // 等待人类回应者操作
    return (
      <AlertDialog open={true}>
        <AlertDialogContent className="bg-slate-900 border-emerald-900/50 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-400">
              📡 等待回应
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              等待其他玩家回应你的广播...
              <div className="mt-3 space-y-1">
                {humanResponders.map(r => (
                  <div key={r.playerId} className="text-sm text-slate-300">
                    • {r.playerName} 需要回应
                  </div>
                ))}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              className="border-red-500/50 text-red-400 hover:bg-red-950/30"
              onClick={doCancelBroadcast}
            >
              取消广播
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const respondedPlayers = broadcast.responses.filter(r => r.responded && r.agreed);

  if (respondedPlayers.length === 0) {
    // No one responded
    return (
      <AlertDialog open={true}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-400">
              📡 无人回应
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              没有玩家回应你的广播，你将获得 1 点能量。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={doCancelBroadcast} className="bg-slate-700 hover:bg-slate-600 text-white">
              确定
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="bg-slate-900 border-emerald-900/50 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-emerald-400">
            📡 选择回应者
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            以下玩家回应了你的广播，选择一位进行结算：
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          {respondedPlayers.map(r => {
            const responder = players.find(p => p.id === r.playerId);
            return (
              <Button
                key={r.playerId}
                variant="outline"
                className="w-full justify-start bg-slate-800 border-slate-700 hover:bg-slate-700 text-white"
                onClick={() => doSelectBroadcastResponder(r.playerId)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="font-bold">{responder?.name}</span>
                  <Badge variant="outline" className="text-[8px] border-slate-600 text-slate-400">
                    {r.mustRespond ? '必须回应' : '自愿回应'}
                  </Badge>
                  {r.responseCard && (
                    <Badge className="text-[8px] border-0 bg-emerald-500/20 text-emerald-300">
                      {r.responseCard.name} ({r.responseCard.subtype === 'cooperation' ? '合作' : '伪装'})
                    </Badge>
                  )}
                </div>
              </Button>
            );
          })}
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            className="border-red-500/50 text-red-400 hover:bg-red-950/30"
            onClick={doCancelBroadcast}
          >
            取消广播
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Broadcast result display (briefly shows result) */
export function BroadcastResultToast() {
  // This is handled through the game log instead
  return null;
}
