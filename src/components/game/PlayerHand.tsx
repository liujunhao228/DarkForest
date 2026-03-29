'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { GameCard } from './GameCard';
import { Card } from '@/lib/game/types';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { StarMap } from './StarMap';
import { getSystemsInRange } from '@/lib/game/starmap';

type ActionMode = 'none' | 'broadcast' | 'strike' | 'deploy' | 'recycle' | 'discard';

export function PlayerHand() {
  const humanPlayer = useGameStore(s => s.players.find(p => p.id === s.humanPlayerId));
  const currentPlayerIndex = useGameStore(s => s.currentPlayerIndex);
  const players = useGameStore(s => s.players);
  const pendingAction = useGameStore(s => s.pendingAction);
  const isProcessing = useGameStore(s => s.isProcessing);
  const broadcast = useGameStore(s => s.broadcast);

  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [actionMode, setActionMode] = useState<ActionMode>('none');
  const [targetSystemDialog, setTargetSystemDialog] = useState(false);
  const [currentActionCard, setCurrentActionCard] = useState<Card | null>(null);

  const isHumanTurn = players[currentPlayerIndex]?.id === humanPlayer?.id;
  // 弃牌并结束回合在任何情况下都应该可用（即使有 pendingAction）
  const canAct = isHumanTurn && !pendingAction && !broadcast && !isProcessing;
  const canDiscard = isHumanTurn && !broadcast && !isProcessing;

  const deployDefenseOrFacility = useGameStore(s => s.deployDefenseOrFacility);
  const launchStrike = useGameStore(s => s.launchStrike);
  const startBroadcast = useGameStore(s => s.startBroadcast);
  const endPlayerTurnWithDiscard = useGameStore(s => s.endPlayerTurnWithDiscard);
  const doRecycleCard = useGameStore(s => s.doRecycleCard);
  const doUseLightspeedShip = useGameStore(s => s.doUseLightspeedShip);
  const getValidBroadcastTargets = useGameStore(s => s.getValidBroadcastTargets);
  const getValidStrikeTargets = useGameStore(s => s.getValidStrikeTargets);

  if (!humanPlayer || humanPlayer.eliminated) return null;

  const handleCardClick = (card: Card) => {
    if (!canAct) return;

    if (actionMode === 'deploy') {
      if ((card.type === 'defense' || card.type === 'facility') && humanPlayer.energy >= card.energy) {
        deployDefenseOrFacility(card.uid);
        setActionMode('none');
      }
      return;
    }

    if (actionMode === 'broadcast') {
      if (card.type === 'broadcast' && humanPlayer.energy >= card.energy) {
        setCurrentActionCard(card);
        setTargetSystemDialog(true);
      }
      return;
    }

    if (actionMode === 'strike') {
      if (card.type === 'strike' && humanPlayer.energy >= card.energy) {
        setCurrentActionCard(card);
        setTargetSystemDialog(true);
      }
      return;
    }

    if (actionMode === 'discard') {
      // 在弃牌模式下，点击卡牌进行选择
      setSelectedCards(prev => {
        const next = new Set(prev);
        if (next.has(card.uid)) {
          next.delete(card.uid);
        } else {
          next.add(card.uid);
        }
        return next;
      });
      return;
    }

    if (actionMode === 'recycle') {
      doRecycleCard(card.uid);
      setActionMode('none');
      return;
    }
  };

  const handleSystemSelect = (systemId: number) => {
    if (!currentActionCard) return;

    if (actionMode === 'broadcast') {
      startBroadcast(currentActionCard.uid, systemId);
    } else if (actionMode === 'strike') {
      launchStrike(currentActionCard.uid, systemId);
    }

    setCurrentActionCard(null);
    setTargetSystemDialog(false);
    setActionMode('none');
  };

  const handleConfirmDiscard = () => {
    endPlayerTurnWithDiscard(Array.from(selectedCards));
    setSelectedCards(new Set());
    setActionMode('none');
  };

  const handleStartDiscard = () => {
    setActionMode('discard');
    setSelectedCards(new Set());
  };

  const hasLightspeedShip = humanPlayer.faceUpCards.some(c => c.ability === 'escape');
  const validTargets = currentActionCard
    ? actionMode === 'broadcast'
      ? getValidBroadcastTargets(currentActionCard)
      : actionMode === 'strike'
        ? getValidStrikeTargets(currentActionCard)
        : []
    : [];

  return (
    <>
      {/* Action bar */}
      {isHumanTurn && canAct && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/90 border-t border-slate-700/50 flex-wrap">
          <span className="text-xs text-slate-400 mr-2">行动：</span>
          <Button
            size="sm"
            variant={actionMode === 'broadcast' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setActionMode(actionMode === 'broadcast' ? 'none' : 'broadcast')}
          >
            📡 广播
          </Button>
          <Button
            size="sm"
            variant={actionMode === 'strike' ? 'destructive' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setActionMode(actionMode === 'strike' ? 'none' : 'strike')}
          >
            💥 打击
          </Button>
          <Button
            size="sm"
            variant={actionMode === 'deploy' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setActionMode(actionMode === 'deploy' ? 'none' : 'deploy')}
          >
            🛡️ 部署
          </Button>
          <Button
            size="sm"
            variant={actionMode === 'recycle' ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setActionMode(actionMode === 'recycle' ? 'none' : 'recycle')}
          >
            ♻️ 回收
          </Button>
          {hasLightspeedShip && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-purple-400 border-purple-500/50"
              onClick={doUseLightspeedShip}
            >
              🚀 光速飞船
            </Button>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-amber-400 border-amber-500/50 hover:bg-amber-950/50"
            onClick={handleStartDiscard}
            disabled={!canDiscard}
          >
            🗑️ 弃牌并结束回合
          </Button>
        </div>
      )}

      {/* 即使不能行动，也显示弃牌按钮（例如有 pendingAction 时） */}
      {isHumanTurn && !canAct && canDiscard && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/90 border-t border-slate-700/50">
          <span className="text-xs text-slate-400">当前无法执行行动，但可以：</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-amber-400 border-amber-500/50 hover:bg-amber-950/50"
            onClick={handleStartDiscard}
          >
            🗑️ 弃牌并结束回合
          </Button>
        </div>
      )}

      {/* Discard confirm */}
      {actionMode === 'discard' && selectedCards.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/50 border-t border-amber-800/30">
          <span className="text-xs text-amber-400">已选择 {selectedCards.size} 张牌要弃掉</span>
          <Button size="sm" className="h-7 text-xs" onClick={handleConfirmDiscard}>
            确认弃牌
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSelectedCards(new Set()); setActionMode('none'); }}>
            取消
          </Button>
        </div>
      )}

      {/* 弃牌模式提示 - 即使没有选择牌也要显示 */}
      {actionMode === 'discard' && selectedCards.size === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-950/30 border-t border-amber-800/30">
          <p className="text-xs text-amber-300 flex-1">
            🗑️ 点击手牌选择要弃掉的牌（可选），然后确认结束回合
          </p>
          <Button size="sm" className="h-7 text-xs" onClick={handleConfirmDiscard}>
            确认弃牌并结束回合
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setSelectedCards(new Set()); setActionMode('none'); }}>
            取消
          </Button>
        </div>
      )}

      {/* Action mode hint */}
      {actionMode !== 'none' && actionMode !== 'discard' && (
        <div className="px-4 py-1.5 bg-slate-800/80 border-t border-slate-700/50">
          <p className="text-xs text-center text-slate-300">
            {actionMode === 'broadcast' && '📡 点击一张广播牌来发送广播'}
            {actionMode === 'strike' && '💥 点击一张打击牌来发射打击'}
            {actionMode === 'deploy' && '🛡️ 点击一张防御牌或设施牌来部署'}
            {actionMode === 'recycle' && '♻️ 点击一张场上的门牌来回收'}
            {actionMode === 'discard' && '🗑️ 选择要弃掉的牌，然后确认结束回合'}
          </p>
        </div>
      )}

      {/* Face-up cards */}
      {humanPlayer.faceUpCards.length > 0 && (
        <div className="px-4 pt-2 pb-1">
          <div className="text-[10px] text-slate-500 mb-1">场上门牌</div>
          <div className="flex gap-1.5">
            {humanPlayer.faceUpCards.map(card => (
              <GameCard
                key={card.uid}
                card={card}
                compact
                onClick={() => actionMode === 'recycle' && handleCardClick(card)}
                selected={actionMode === 'recycle'}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hand cards */}
      <div className="px-4 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-500">手牌 ({humanPlayer.hand.length}张)</span>
          <span className="text-[10px] text-yellow-500">⚡ {humanPlayer.energy} 能量</span>
        </div>
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            <AnimatePresence mode="popLayout">
              {humanPlayer.hand.map(card => (
                <GameCard
                  key={card.uid}
                  card={card}
                  inHand={canAct}
                  disabled={!canAct || (actionMode !== 'discard' && card.type !== 'broadcast' && card.type !== 'strike' && card.type !== 'defense' && card.type !== 'facility')}
                  selected={selectedCards.has(card.uid)}
                  onClick={() => handleCardClick(card)}
                />
              ))}
            </AnimatePresence>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* System selection dialog */}
      <Dialog open={targetSystemDialog} onOpenChange={setTargetSystemDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {actionMode === 'broadcast' ? '📡 选择广播目标星系' : '💥 选择打击目标星系'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <StarMap
              highlightSystems={validTargets}
              onSystemClick={handleSystemSelect}
              interactiveMode
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setTargetSystemDialog(false); setCurrentActionCard(null); }}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
