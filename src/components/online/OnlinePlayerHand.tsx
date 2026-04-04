'use client';

import { useState, memo } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { GameCard } from '@/components/game/GameCard';
import { Card } from '@/lib/game/types';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { StarMap } from '@/components/game/StarMap';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

/**
 * 在线游戏 - 玩家手牌组件
 * 使用 useOnlineGameStore 而非 useGameStore
 */
export const OnlinePlayerHand = memo(() => {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);

  if (!gameState) return null;

  const { players, currentPlayerIndex, humanPlayerId, turnPhase, pendingAction, isProcessing } = gameState;
  const humanPlayer = players.find(p => p.id === humanPlayerId);
  const isHumanTurn = players[currentPlayerIndex]?.id === humanPlayerId;
  const canAct = isHumanTurn && turnPhase === 'actionPhase' && !isProcessing;

  // 对话框状态
  const [strikeDialogOpen, setStrikeDialogOpen] = useState(false);
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);
  const [facilityDialogOpen, setFacilityDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [selectedDiscardCards, setSelectedDiscardCards] = useState<string[]>([]);

  if (!humanPlayer || humanPlayer.eliminated) return null;

  /**
   * 处理卡牌点击
   */
  const handleCardClick = (card: Card) => {
    if (!canAct) return;

    if (humanPlayer.energy < card.energy) {
      toast.error('能量不足', {
        description: `需要 ${card.energy} 点能量，当前只有 ${humanPlayer.energy} 点`,
      });
      return;
    }

    switch (card.type) {
      case 'defense':
      case 'facility':
        // 直接部署
        sendAction('playCard', { cardUid: card.uid });
        toast.success('卡牌已部署', { description: `【${card.name}】` });
        break;

      case 'strike':
        // 打开打击对话框
        setCurrentCard(card);
        setStrikeDialogOpen(true);
        break;

      case 'broadcast':
        // 打开广播对话框
        setCurrentCard(card);
        setBroadcastDialogOpen(true);
        break;
    }
  };

  /**
   * 处理星系选择（打击）
   */
  const handleStrikeTargetSelect = (systemId: number) => {
    if (!currentCard) return;
    sendAction('playCard', {
      cardUid: currentCard.uid,
      targetSystem: systemId,
    });
    setStrikeDialogOpen(false);
    setCurrentCard(null);
    toast.success('打击已发射', { description: `飞向星系 ${systemId}` });
  };

  /**
   * 处理星系选择（广播）
   */
  const handleBroadcastTargetSelect = (systemId: number) => {
    if (!currentCard) return;
    sendAction('playCard', {
      cardUid: currentCard.uid,
      targetSystem: systemId,
    });
    setBroadcastDialogOpen(false);
    setCurrentCard(null);
    toast.success('广播已发送', { description: `目标星系 ${systemId}` });
  };

  /**
   * 结束回合
   */
  const handleEndTurn = () => {
    sendAction('endTurn', { discardCards: selectedDiscardCards });
    setDiscardDialogOpen(false);
    setSelectedDiscardCards([]);
    toast.success('回合已结束');
  };

  /**
   * 切换弃牌选择
   */
  const toggleDiscardCard = (cardUid: string) => {
    setSelectedDiscardCards(prev => {
      if (prev.includes(cardUid)) {
        return prev.filter(uid => uid !== cardUid);
      } else {
        return [...prev, cardUid];
      }
    });
  };

  return (
    <>
      {/* 行动按钮栏 */}
      {canAct && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/90 border-t border-slate-700/50">
          <span className="text-xs text-slate-400 mr-2">行动：</span>
          <span className="text-xs text-slate-500">💡 直接点击手牌中的卡牌来使用</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs ml-auto"
            onClick={() => {
              setSelectedDiscardCards([]);
              setDiscardDialogOpen(true);
            }}
          >
            🗑️ 弃牌结束
          </Button>
        </div>
      )}

      {/* 场上门牌 */}
      {humanPlayer.faceUpCards.length > 0 && (
        <div className="px-4 pt-2 pb-1">
          <div className="text-[10px] text-slate-500 mb-1">场上门牌</div>
          <div className="flex gap-1.5">
            {humanPlayer.faceUpCards.map((card: Card) => (
              <GameCard
                key={card.uid}
                card={card}
                compact
                disabled={!canAct}
              />
            ))}
          </div>
        </div>
      )}

      {/* 手牌区域 */}
      <div className="px-4 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-500">手牌 ({humanPlayer.hand.length}张)</span>
          <span className="text-[10px] text-yellow-500">⚡ {humanPlayer.energy} 能量</span>
        </div>
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            {humanPlayer.hand.map((card: Card) => {
              const canAfford = humanPlayer.energy >= card.energy;
              const isDisabled = !canAct || !canAfford;

              return (
                <GameCard
                  key={card.uid}
                  card={card}
                  inHand={!isDisabled}
                  disabled={isDisabled}
                  onClick={() => handleCardClick(card)}
                  showSubtype
                />
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* 打击牌目标选择对话框 */}
      <Dialog open={strikeDialogOpen} onOpenChange={setStrikeDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-red-400">💥</span>
              选择打击目标星系
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              选择打击目标星系，打击牌将飞向该星系
            </DialogDescription>
            {currentCard && (
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-red-500/20 text-red-300 border-0">
                  {currentCard.name}
                </Badge>
                <span className="text-yellow-400">⚡{currentCard.energy}</span>
                {currentCard.level && (
                  <span className="text-red-400">Lv.{currentCard.level}</span>
                )}
              </div>
            )}
          </DialogHeader>

          <div className="py-4">
            <StarMap
              highlightSystems={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
              onSystemClick={handleStrikeTargetSelect}
              interactiveMode
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setStrikeDialogOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 广播牌目标选择对话框 */}
      <Dialog open={broadcastDialogOpen} onOpenChange={setBroadcastDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-emerald-400">📡</span>
              选择广播目标星系
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              选择广播目标星系
            </DialogDescription>
            {currentCard && (
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-0">
                  {currentCard.name}
                </Badge>
                <span className="text-yellow-400">⚡{currentCard.energy}</span>
                {currentCard.subtype && (
                  <Badge className={
                    currentCard.subtype === 'cooperation'
                      ? 'bg-green-500/20 text-green-300 border-0'
                      : 'bg-orange-500/20 text-orange-300 border-0'
                  }>
                    {currentCard.subtype === 'cooperation' ? '合作' : '伪装'}
                  </Badge>
                )}
              </div>
            )}
          </DialogHeader>
          <div className="py-4">
            <StarMap
              highlightSystems={[1, 2, 3, 4, 5, 6, 7, 8, 9]}
              onSystemClick={handleBroadcastTargetSelect}
              interactiveMode
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBroadcastDialogOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弃牌对话框 */}
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-slate-400">🗑️</span>
              弃牌结束回合
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              选择要弃掉的手牌，然后结束回合。也可以不弃牌直接结束。
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {humanPlayer.hand.length === 0 ? (
              <div className="text-center text-slate-500 py-8">没有手牌可弃</div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto p-2 bg-slate-800/50 rounded-lg">
                {humanPlayer.hand.map((card: Card) => {
                  const isSelected = selectedDiscardCards.includes(card.uid);
                  return (
                    <div
                      key={card.uid}
                      className={`cursor-pointer transition-all ${
                        isSelected ? 'opacity-50 scale-95' : 'hover:scale-105'
                      }`}
                      onClick={() => toggleDiscardCard(card.uid)}
                    >
                      <GameCard card={card} compact selected={isSelected} showSubtype />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardDialogOpen(false)}>
              取消
            </Button>
            <Button
              variant="default"
              onClick={handleEndTurn}
              className="bg-slate-600 hover:bg-slate-700"
            >
              {selectedDiscardCards.length > 0
                ? `弃掉 ${selectedDiscardCards.length} 张牌并结束`
                : '直接结束回合'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

OnlinePlayerHand.displayName = 'OnlinePlayerHand';
