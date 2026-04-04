'use client';

import { useState, memo, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { useShallow } from 'zustand/shallow';
import { GameCard } from './GameCard';
import { Card, Player } from '@/lib/game/types';
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
import { StarMap } from './StarMap';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

// 常量定义在组件外部
const TURNDOWN_LABELS = {
  recycle: '♻️ 回收门牌',
  lightspeed: '🚀 光速飞船',
  endTurn: '✔️ 结束回合',
};

// 使用 useShallow 优化选择器
const useGameShallow = <T,>(selector: (s: any) => T): T => {
  return useGameStore(useShallow(selector));
};

/**
 * 玩家手牌组件
 *
 * 重构后的交互逻辑：
 * - 直接点击卡牌，根据卡牌类型弹出对应操作对话框
 * - 防御牌：直接部署
 * - 设施牌：弹出确认对话框
 * - 打击牌：弹出星图选择目标
 * - 广播牌：弹出星图选择目标
 * - 回收模式：点击场上门牌回收
 */
export const PlayerHand = memo(() => {
  // 使用 selector 优化状态订阅
  const { humanPlayer, currentPlayerIndex, players, pendingAction, isProcessing, broadcast, turnPhase } = useGameShallow((s) => ({
    humanPlayer: s.players.find((p: any) => p.id === s.humanPlayerId),
    currentPlayerIndex: s.currentPlayerIndex,
    players: s.players,
    pendingAction: s.pendingAction,
    isProcessing: s.isProcessing,
    broadcast: s.broadcast,
    turnPhase: s.turnPhase,
  }));

  // Store actions - 稳定引用
  const deployDefenseOrFacility = useGameStore(s => s.deployDefenseOrFacility);
  const launchStrike = useGameStore(s => s.launchStrike);
  const startBroadcast = useGameStore(s => s.startBroadcast);
  const doRecycleCard = useGameStore(s => s.doRecycleCard);
  const doUseLightspeedShip = useGameStore(s => s.doUseLightspeedShip);
  const endTurn = useGameStore(s => s.endTurn);
  const discardCards = useGameStore(s => s.discardCards);
  const getValidBroadcastTargets = useGameStore(s => s.getValidBroadcastTargets);
  const getValidStrikeTargets = useGameStore(s => s.getValidStrikeTargets);

  // 对话框状态
  const [strikeDialogOpen, setStrikeDialogOpen] = useState(false);
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);
  const [facilityDialogOpen, setFacilityDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [recycleMode, setRecycleMode] = useState(false);
  const [selectedDiscardCards, setSelectedDiscardCards] = useState<string[]>([]);

  const isHumanTurn = players[currentPlayerIndex]?.id === humanPlayer?.id;
  // canAct: 是否可以进行打牌等操作
  // 允许在广播等待回应时进行其他操作（除了不能结束回合）
  const canAct = isHumanTurn && turnPhase === 'actionPhase' && !isProcessing;
  // canEndTurn: 是否可以结束回合（只要是人类回合且在行动阶段即可）
  const canEndTurn = isHumanTurn && turnPhase === 'actionPhase' && !isProcessing;

  if (!humanPlayer || humanPlayer.eliminated) return null;

  // 检查是否有光速飞船 - memoized
  const hasLightspeedShip = useMemo(
    () => humanPlayer.faceUpCards.some((c: Card) => c.ability === 'escape'),
    [humanPlayer.faceUpCards]
  );

  // 获取有效目标
  const validBroadcastTargets = currentCard ? getValidBroadcastTargets(currentCard) : [];
  const validStrikeTargets = currentCard ? getValidStrikeTargets(currentCard) : [];

  /**
   * 处理卡牌点击
   * 根据卡牌类型弹出对应对话框或直接执行操作
   */
  const handleCardClick = (card: Card) => {
    if (!canAct) return;

    // 检查能量是否足够
    if (humanPlayer.energy < card.energy) {
      toast.error('能量不足', {
        description: `需要 ${card.energy} 点能量，当前只有 ${humanPlayer.energy} 点`,
      });
      return;
    }

    switch (card.type) {
      case 'defense':
        // 防御牌：直接部署
        const success = deployDefenseOrFacility(card.uid);
        if (success) {
          toast.success('防御牌部署成功', {
            description: `【${card.name}】已部署到你的文明`,
          });
        }
        break;

      case 'facility':
        // 设施牌：打开确认对话框
        setCurrentCard(card);
        setFacilityDialogOpen(true);
        break;

      case 'strike':
        // 打击牌：打开目标选择对话框
        setCurrentCard(card);
        setStrikeDialogOpen(true);
        break;

      case 'broadcast':
        // 广播牌：打开目标选择对话框
        setCurrentCard(card);
        setBroadcastDialogOpen(true);
        break;
    }
  };

  /**
   * 确认部署设施牌
   */
  const confirmDeployFacility = () => {
    if (!currentCard) return;
    const success = deployDefenseOrFacility(currentCard.uid);
    if (success) {
      toast.success('设施部署成功', {
        description: `【${currentCard.name}】已部署到你的文明，每回合将产生收益`,
      });
    } else {
      toast.error('设施部署失败', {
        description: '该设施可能已有同类建筑或条件不满足',
      });
    }
    setFacilityDialogOpen(false);
    setCurrentCard(null);
  };

  /**
   * 关闭设施确认对话框
   */
  const closeFacilityDialog = () => {
    setFacilityDialogOpen(false);
    setCurrentCard(null);
  };

  /**
   * 处理回收模式下的卡牌点击
   */
  const handleRecycleClick = (card: Card) => {
    if (!canAct || !recycleMode) return;
    doRecycleCard(card.uid);
    setRecycleMode(false);
  };

  /**
   * 处理星系选择（打击）
   */
  const handleStrikeTargetSelect = (systemId: number) => {
    if (!currentCard) return;
    launchStrike(currentCard.uid, systemId);
    setStrikeDialogOpen(false);
    setCurrentCard(null);
  };

  /**
   * 处理玩家选择（科技锁死）
   */
  const handleTechLockTargetSelect = (targetPlayerId: string) => {
    if (!currentCard || !humanPlayer) return;
    const targetPlayer = players.find((p: any) => p.id === targetPlayerId);
    if (!targetPlayer) return;
    
    // 科技锁死：指定目标玩家，打击牌飞向目标玩家当前所在星系
    launchStrike(currentCard.uid, targetPlayer.position, targetPlayerId);
    setStrikeDialogOpen(false);
    setCurrentCard(null);
  };

  /**
   * 处理星系选择（广播）
   */
  const handleBroadcastTargetSelect = (systemId: number) => {
    if (!currentCard) return;
    startBroadcast(currentCard.uid, systemId);
    setBroadcastDialogOpen(false);
    setCurrentCard(null);
  };

  /**
   * 关闭对话框时的清理
   */
  const closeStrikeDialog = () => {
    setStrikeDialogOpen(false);
    setCurrentCard(null);
  };

  const closeBroadcastDialog = () => {
    setBroadcastDialogOpen(false);
    setCurrentCard(null);
  };

  /**
   * 打开弃牌对话框
   */
  const openDiscardDialog = () => {
    setSelectedDiscardCards([]);
    setDiscardDialogOpen(true);
  };

  /**
   * 关闭弃牌对话框
   */
  const closeDiscardDialog = () => {
    setDiscardDialogOpen(false);
    setSelectedDiscardCards([]);
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

  /**
   * 确认弃牌并结束回合
   */
  const confirmDiscardAndEndTurn = () => {
    if (selectedDiscardCards.length > 0) {
      discardCards(selectedDiscardCards);
    }
    endTurn();
    closeDiscardDialog();
    toast.success('回合结束', {
      description: selectedDiscardCards.length > 0 
        ? `弃掉了 ${selectedDiscardCards.length} 张牌`
        : '正常结束回合',
    });
  };

  return (
    <>
      {/* 行动按钮栏 */}
      {canEndTurn && (
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/90 border-t border-slate-700/50 flex-wrap">
          <span className="text-xs text-slate-400 mr-2">行动：</span>
          <span className="text-xs text-slate-500">
            💡 直接点击手牌中的卡牌来使用
          </span>
          <Button
            size="sm"
            variant={recycleMode ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setRecycleMode(!recycleMode)}
            disabled={!canAct}
          >
            ♻️ 回收门牌
          </Button>
          {hasLightspeedShip && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-purple-400 border-purple-500/50"
              onClick={doUseLightspeedShip}
              disabled={!canAct}
            >
              🚀 光速飞船
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs ml-auto"
            onClick={openDiscardDialog}
          >
            🗑️ 弃牌结束
          </Button>
        </div>
      )}

      {/* 回收模式提示 */}
      {recycleMode && (
        <div className="px-4 py-1.5 bg-slate-800/80 border-t border-slate-700/50">
          <p className="text-xs text-center text-slate-300">
            ♻️ 回收模式：点击场上的门牌来回收（获得 50% 能量返还）
          </p>
        </div>
      )}

      {/* 场上门牌 */}
      {humanPlayer.faceUpCards.length > 0 && (
        <div className="px-4 pt-2 pb-1">
          <div className="text-[10px] text-slate-500 mb-1">场上门牌（点击可回收）</div>
          <div className="flex gap-1.5">
            {humanPlayer.faceUpCards.map((card: Card) => (
              <GameCard
                key={card.uid}
                card={card}
                compact
                onClick={() => handleRecycleClick(card)}
                selected={recycleMode}
                disabled={!recycleMode || !canAct}
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
            <AnimatePresence mode="popLayout">
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
            </AnimatePresence>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* 打击牌目标选择对话框 */}
      <Dialog open={strikeDialogOpen} onOpenChange={closeStrikeDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-red-400">💥</span>
              {currentCard?.effect === 'discard_hand' ? '选择科技锁死目标' : '选择打击目标星系'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {currentCard?.effect === 'discard_hand'
                ? '选择一个文明进行科技锁死，打击牌将追踪目标'
                : '选择打击目标星系，打击牌将飞向该星系'}
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
          
          {currentCard?.effect === 'discard_hand' ? (
            // 科技锁死：选择目标玩家
            <div className="py-4 space-y-2">
              <p className="text-xs text-slate-400">可锁定的文明：</p>
              {players
                .filter((p: Player) => p.id !== humanPlayer?.id && !p.eliminated)
                .map((p: Player) => (
                  <button
                    key={p.id}
                    onClick={() => handleTechLockTargetSelect(p.id)}
                    className="w-full flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg border border-slate-700 transition-colors"
                  >
                    <div className={`w-3 h-3 rounded-full bg-${p.color}-500`} />
                    <div className="flex-1 text-left">
                      <div className="font-bold text-white">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        星系 {p.position} · 手牌 {p.hand.length} 张 · 能量 {p.energy}
                      </div>
                    </div>
                    <span className="text-xs text-red-400">点击锁定</span>
                  </button>
                ))}
            </div>
          ) : (
            // 普通打击：选择星系
            <div className="py-4">
              <StarMap
                highlightSystems={validStrikeTargets}
                onSystemClick={handleStrikeTargetSelect}
                interactiveMode
              />
            </div>
          )}
          
          <DialogFooter>
            <Button variant="ghost" onClick={closeStrikeDialog}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 广播牌目标选择对话框 */}
      <Dialog open={broadcastDialogOpen} onOpenChange={closeBroadcastDialog}>
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
                {currentCard.range && currentCard.range < 100 && (
                  <span className="text-emerald-400">范围 {currentCard.range}</span>
                )}
                {currentCard.range && currentCard.range >= 100 && (
                  <span className="text-emerald-400">无限范围</span>
                )}
              </div>
            )}
          </DialogHeader>
          <div className="py-4">
            <StarMap
              highlightSystems={validBroadcastTargets}
              onSystemClick={handleBroadcastTargetSelect}
              interactiveMode
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeBroadcastDialog}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 设施牌确认对话框 */}
      <Dialog open={facilityDialogOpen} onOpenChange={closeFacilityDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-cyan-400">🏭</span>
              确认部署设施
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              确认要将此设施部署到你的文明吗？
            </DialogDescription>
          </DialogHeader>
          {currentCard && (
            <div className="py-4 space-y-4">
              {/* 卡牌信息 */}
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                <div className="flex-1">
                  <div className="font-bold text-white">{currentCard.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{currentCard.description}</div>
                </div>
                <div className="text-right">
                  <div className="text-yellow-400 font-bold">⚡ {currentCard.energy}</div>
                  {currentCard.energyPerTurn && (
                    <div className="text-xs text-emerald-400">
                      +{currentCard.energyPerTurn} 能量/回合
                    </div>
                  )}
                </div>
              </div>

              {/* 玩家状态 */}
              <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                <span className="text-sm text-slate-400">当前能量</span>
                <span className={`text-lg font-bold ${
                  humanPlayer.energy >= currentCard.energy
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }`}>
                  ⚡ {humanPlayer.energy}
                </span>
              </div>

              {/* 特殊提示 */}
              {currentCard.defId === 'facility_dyson_sphere' && (
                <div className="p-2 bg-amber-950/30 border border-amber-900/50 rounded text-xs text-amber-300">
                  ⚠️ 注意：每个星系只能建造 1 个戴森球
                </div>
              )}
              {currentCard.defId === 'facility_lightspeed_ship' && (
                <div className="p-2 bg-purple-950/30 border border-purple-900/50 rounded text-xs text-purple-300">
                  ⚠️ 注意：使用后弃置此牌，可跃迁至随机无文明星系
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={closeFacilityDialog}>
              取消
            </Button>
            <Button
              variant="default"
              onClick={confirmDeployFacility}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              确认部署
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弃牌对话框 */}
      <Dialog open={discardDialogOpen} onOpenChange={closeDiscardDialog}>
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
            <div className="text-sm text-slate-300 mb-3">
              当前手牌（{humanPlayer.hand.length} 张）- 点击选择要弃掉的牌
            </div>
            {humanPlayer.hand.length === 0 ? (
              <div className="text-center text-slate-500 py-8">
                没有手牌可弃
              </div>
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
                      <GameCard
                        card={card}
                        compact
                        selected={isSelected}
                        showSubtype
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {selectedDiscardCards.length > 0 && (
              <div className="mt-3 text-sm text-slate-400">
                已选择 <span className="text-yellow-400 font-bold">{selectedDiscardCards.length}</span> 张牌
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDiscardDialog}>
              取消
            </Button>
            <Button
              variant="default"
              onClick={confirmDiscardAndEndTurn}
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

PlayerHand.displayName = 'PlayerHand';
