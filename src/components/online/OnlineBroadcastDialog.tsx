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
import { GameCard } from '@/components/game/GameCard';
import { Radio, Ban } from 'lucide-react';
import type { Player, Card, BroadcastResponse } from '@/lib/game/types';

/** Online Broadcast Response Dialog */
export function OnlineBroadcastResponseDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);

  // 使用自定义 hook 获取本地玩家 ID
  const localPlayerId = useLocalPlayerId();
  
  if (!gameState) return null;

  const { broadcast, players, pendingAction } = gameState;

  const humanPlayerId = localPlayerId || gameState.humanPlayerId;

  if (!broadcast || !broadcast.active) return null;

  // Check if human player needs to respond
  const humanResponse = broadcast.responses.find((r: BroadcastResponse) => r.playerId === humanPlayerId);
  if (!humanResponse || !humanResponse.canRespond || humanResponse.responded) return null;

  const broadcaster = players.find(p => p.id === broadcast.broadcasterId);
  const humanPlayer = players.find(p => p.id === humanPlayerId);
  const broadcastCards = (humanPlayer?.hand || []).filter(c => c.type === 'broadcast' && (humanPlayer?.energy ?? 0) >= c.energy);

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="bg-slate-900 border-emerald-900/50 text-white max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-emerald-400 flex items-center gap-2">
            <Radio className="w-5 h-5" /> 收到广播信号
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
                {broadcastCards.map((card: Card) => (
                  <div key={card.uid} className="cursor-pointer transition-transform duration-200 hover:scale-105" onClick={() => {
                    sendAction('respondBroadcast', { playerId: humanPlayerId, agreed: true, cardUid: card.uid });
                  }} role="button" aria-label={`使用 ${card.name} 回应广播`} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sendAction('respondBroadcast', { playerId: humanPlayerId, agreed: true, cardUid: card.uid }); } }}>
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
              onClick={() => sendAction('respondBroadcast', { playerId: humanPlayerId, agreed: false })}
            >
              <Ban className="w-4 h-4 mr-2" /> 不回应
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Online Broadcast Select Responder Dialog */
export function OnlineBroadcastSelectResponderDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);

  // 使用自定义 hook 获取本地玩家 ID
  const localPlayerId = useLocalPlayerId();

  if (!gameState) return null;

  const { broadcast, players } = gameState;

  const humanPlayerId = localPlayerId || gameState.humanPlayerId;

  if (!broadcast || !broadcast.active) return null;
  if (broadcast.broadcasterId !== humanPlayerId) return null;

  // 检查是否所有回应都已收到
  const allResponded = broadcast.responses.every((r: BroadcastResponse) => r.responded);

  // 如果有人类需要回应但还未回应，显示等待提示
  const humanResponders = broadcast.responses.filter((r: BroadcastResponse) => r.canRespond && !r.responded);

  if (humanResponders.length > 0) {
    // 等待人类回应者操作
    return (
      <AlertDialog open={true}>
        <AlertDialogContent className="bg-slate-900 border-emerald-900/50 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-400 flex items-center gap-2">
              <Radio className="w-5 h-5" /> 等待回应
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              等待其他玩家回应你的广播...
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6 space-y-1">
            {humanResponders.map((r: BroadcastResponse) => (
              <div key={r.playerId} className="text-sm text-slate-300">
                • {r.playerName} 需要回应
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <Button
              variant="outline"
              className="border-red-500/50 text-red-400 hover:bg-red-950/30"
              onClick={() => {
                sendAction('cancelBroadcast', {});
              }}
            >
              取消广播
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const respondedPlayers = broadcast.responses.filter((r: BroadcastResponse) => r.responded && r.agreed);

  // 如果已经选择了回应者，显示揭示/等待结算
  if (broadcast.selectedResponderId) {
    const selectedResponder = respondedPlayers.find((r: BroadcastResponse) => r.playerId === broadcast.selectedResponderId);
    const selectedPlayer = players.find(p => p.id === broadcast.selectedResponderId);
    
    return (
      <AlertDialog open={true}>
        <AlertDialogContent className="bg-slate-900 border-emerald-900/50 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-emerald-400 flex items-center gap-2">
              <Radio className="w-5 h-5" /> 已选择回应者
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              你选择了 <span className="text-emerald-400 font-bold">{selectedPlayer?.name}</span> 的回应
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-6">
            <div className="text-sm text-slate-300">
              正在揭示双方卡牌，等待结算...
            </div>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (respondedPlayers.length === 0) {
    // No one responded
    return (
      <AlertDialog open={true}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-400 flex items-center gap-2">
              <Radio className="w-5 h-5" /> 无人回应
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-500">
              没有玩家回应你的广播，你将获得 1 点能量。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={() => {
                if (process.env.NODE_ENV === 'development') {
                  console.log('[OnlineBroadcast] 无人回应，确认');
                }
              }} className="bg-slate-700 hover:bg-slate-600 text-white">
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
            <Radio className="w-5 h-5" /> 选择回应者
          </AlertDialogTitle>
          <AlertDialogDescription className="text-slate-400">
            以下玩家回应了你的广播，选择一位进行结算：
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          {respondedPlayers.map((r: BroadcastResponse) => {
            const responder = players.find(p => p.id === r.playerId);
            return (
              <Button
                key={r.playerId}
                variant="outline"
                className="w-full justify-start bg-slate-800 border-slate-700 hover:bg-slate-700 text-white"
                onClick={() => sendAction('selectResponder', { responderId: r.playerId })}
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
            onClick={() => {
              sendAction('cancelBroadcast', {});
            }}
          >
            取消广播
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
