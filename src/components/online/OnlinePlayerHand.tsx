'use client';

import { useState, memo, useCallback, useMemo } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { GameCard } from '@/components/game/GameCard';
import { OnlineStarMap } from './OnlineStarMap';
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
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getSystemsInRange, getDistance } from '@/lib/game/starmap';

/**
 * 在线游戏 - 玩家手牌组件
 * 使用 useOnlineGameStore 而非 useGameStore
 * 
 * 功能：
 * - 直接点击卡牌使用
 * - 回收模式：点击场上门牌回收
 * - 光速飞船：特殊移动
 * - 设施确认对话框
 * - 弃牌结束回合
 */
export const OnlinePlayerHand = memo(() => {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const isProcessing = useOnlineGameStore(s => s.isProcessing);
  const pendingAction = useOnlineGameStore(s => s.pendingAction);
  const error = useOnlineGameStore(s => s.error);

  if (!gameState) return null;

  const { players, currentPlayerIndex, turnPhase } = gameState;

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

  // 使用本地玩家 ID 识别自己
  const humanPlayerId = localPlayerId || gameState.humanPlayerId;
  const humanPlayer = players.find(p => p.id === humanPlayerId);
  const isHumanTurn = players[currentPlayerIndex]?.id === humanPlayerId;

  // 调试日志：打印回合状态
  if (typeof window !== 'undefined' && isHumanTurn) {
    console.log('[OnlinePlayerHand] 回合状态诊断:', {
      localPlayerId,
      humanPlayerId,
      currentPlayerIndex,
      currentPlayerId: players[currentPlayerIndex]?.id,
      currentPlayerName: players[currentPlayerIndex]?.name,
      isHumanTurn,
      turnPhase,
      isProcessing,
      canAct: isHumanTurn && turnPhase === 'actionPhase' && !isProcessing,
    });
  }

  const canAct = isHumanTurn && turnPhase === 'actionPhase' && !isProcessing;
  const canEndTurn = isHumanTurn && turnPhase === 'actionPhase' && !isProcessing;

  // 对话框状态
  const [strikeDialogOpen, setStrikeDialogOpen] = useState(false);
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);
  const [facilityDialogOpen, setFacilityDialogOpen] = useState(false);
  const [defenseDialogOpen, setDefenseDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [recycleMode, setRecycleMode] = useState(false);
  const [selectedDiscardCards, setSelectedDiscardCards] = useState<string[]>([]);

  if (!humanPlayer || humanPlayer.eliminated) return null;

  // 检查是否有光速飞船
  const hasLightspeedShip = useMemo(
    () => humanPlayer.faceUpCards.some((c: Card) => c.ability === 'escape'),
    [humanPlayer.faceUpCards]
  );

  /**
   * 处理卡牌点击
   */
  const handleCardClick = useCallback((card: Card) => {
    if (!canAct) return;

    if (humanPlayer.energy < card.energy) {
      toast.error('能量不足', {
        description: `需要 ${card.energy} 点能量，当前只有 ${humanPlayer.energy} 点`,
      });
      return;
    }

    switch (card.type) {
      case 'defense':
        // 防御牌：打开确认对话框
        setCurrentCard(card);
        setDefenseDialogOpen(true);
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
  }, [canAct, humanPlayer.energy, sendAction]);

  /**
   * 确认部署防御牌
   */
  const confirmDeployDefense = useCallback(() => {
    if (!currentCard) return;
    sendAction('playCard', { cardUid: currentCard.uid });
    toast.success('防御牌部署成功', {
      description: `【${currentCard.name}】已部署到你的文明`,
    });
    setDefenseDialogOpen(false);
    setCurrentCard(null);
  }, [currentCard, sendAction]);

  /**
   * 关闭防御确认对话框
   */
  const closeDefenseDialog = useCallback(() => {
    setDefenseDialogOpen(false);
    setCurrentCard(null);
  }, []);

  /**
   * 确认部署设施牌
   */
  const confirmDeployFacility = useCallback(() => {
    if (!currentCard) return;
    sendAction('playCard', { cardUid: currentCard.uid });
    toast.success('设施部署成功', {
      description: `【${currentCard.name}】已部署到你的文明`,
    });
    setFacilityDialogOpen(false);
    setCurrentCard(null);
  }, [currentCard, sendAction]);

  /**
   * 关闭设施确认对话框
   */
  const closeFacilityDialog = useCallback(() => {
    setFacilityDialogOpen(false);
    setCurrentCard(null);
  }, []);

  /**
   * 处理回收模式下的卡牌点击
   */
  const handleRecycleClick = useCallback((card: Card) => {
    if (!canAct || !recycleMode) return;
    sendAction('recycleCard', { cardUid: card.uid });
    setRecycleMode(false);
    toast.success('卡牌已回收', {
      description: `【${card.name}】已回收，获得 50% 能量返还`,
    });
  }, [canAct, recycleMode, sendAction]);

  /**
   * 使用光速飞船
   */
  const handleUseLightspeedShip = useCallback(() => {
    const lightspeedCard = humanPlayer.faceUpCards.find((c: Card) => c.ability === 'escape');
    if (!lightspeedCard) return;
    
    sendAction('playCard', { cardUid: lightspeedCard.uid });
    toast.success('光速飞船已启动', {
      description: '你的文明正在跃迁至随机星系',
    });
  }, [humanPlayer.faceUpCards, sendAction]);

  /**
   * 处理星系选择（打击）
   */
  const handleStrikeTargetSelect = useCallback((systemId: number) => {
    if (!currentCard) return;
    sendAction('playCard', {
      cardUid: currentCard.uid,
      targetSystem: systemId,
    });
    setStrikeDialogOpen(false);
    setCurrentCard(null);
    toast.success('打击已发射', { description: `飞向星系 ${systemId}` });
  }, [currentCard, sendAction]);

  /**
   * 处理玩家选择（科技锁死）
   */
  const handleTechLockTargetSelect = useCallback((targetPlayerId: string) => {
    if (!currentCard || !humanPlayer) return;
    const targetPlayer = players.find((p) => p.id === targetPlayerId);
    if (!targetPlayer) return;

    // 科技锁死：指定目标玩家，打击牌飞向目标玩家当前所在星系
    sendAction('playCard', {
      cardUid: currentCard.uid,
      targetSystem: targetPlayer.position,
      targetPlayerId: targetPlayerId,
    });
    setStrikeDialogOpen(false);
    setCurrentCard(null);
    toast.success('科技锁死已发动', { description: `目标：${targetPlayer.name}` });
  }, [currentCard, humanPlayer, players, sendAction]);

  /**
   * 处理星系选择（广播）
   */
  const handleBroadcastTargetSelect = useCallback((systemId: number) => {
    if (!currentCard) return;
    sendAction('playCard', {
      cardUid: currentCard.uid,
      targetSystem: systemId,
    });
    setBroadcastDialogOpen(false);
    setCurrentCard(null);
    toast.success('广播已发送', { description: `目标星系 ${systemId}` });
  }, [currentCard, sendAction]);

  /**
   * 结束回合
   */
  const handleEndTurn = useCallback(() => {
    sendAction('endTurn', { discardCards: selectedDiscardCards });
    setDiscardDialogOpen(false);
    setSelectedDiscardCards([]);
    toast.success('回合已结束', {
      description: selectedDiscardCards.length > 0
        ? `弃掉了 ${selectedDiscardCards.length} 张牌`
        : '正常结束回合',
    });
  }, [selectedDiscardCards, sendAction]);

  /**
   * 切换弃牌选择
   */
  const toggleDiscardCard = useCallback((cardUid: string) => {
    setSelectedDiscardCards(prev => {
      if (prev.includes(cardUid)) {
        return prev.filter(uid => uid !== cardUid);
      } else {
        return [...prev, cardUid];
      }
    });
  }, []);

  // 获取打击有效目标（简化版，所有星系）
  const validStrikeTargets = useMemo(() => {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  }, []);

  // 获取广播有效目标（根据卡牌 range 和玩家位置动态计算）
  const validBroadcastTargets = useMemo(() => {
    if (!currentCard || currentCard.type !== 'broadcast') return [];
    if (!humanPlayer) return [];

    const range = currentCard.range ?? 1;

    // 超距广播：所有星系（除了当前位置）
    if (range >= 100) {
      return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(s => s !== humanPlayer.position);
    }

    // 普通广播：根据 range 获取范围内星系
    return getSystemsInRange(humanPlayer.position, range);
  }, [currentCard, humanPlayer]);

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
              onClick={handleUseLightspeedShip}
              disabled={!canAct}
            >
              🚀 光速飞船
            </Button>
          )}
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
          <div className="text-[10px] text-slate-500 mb-1">场上门牌{recycleMode ? '（点击可回收）' : ''}</div>
          <div className="flex gap-1.5">
            {humanPlayer.faceUpCards.map((card: Card) => (
              <GameCard
                key={card.uid}
                card={card}
                compact
                onClick={() => recycleMode && handleRecycleClick(card)}
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
          <span className="text-[10px] text-slate-500">手牌 ({humanPlayer.hand?.length ?? 0}张)</span>
          <span className="text-[10px] text-yellow-500">⚡ {humanPlayer.energy} 能量</span>
        </div>

        {/* 处理中提示 */}
        {isProcessing && pendingAction && (
          <div className="mb-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-yellow-300">
                等待服务器响应...
              </span>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-2 px-3 py-1.5 bg-red-900/30 border border-red-700/50 rounded-lg">
            <span className="text-xs text-red-300">
              ❌ {error}
            </span>
          </div>
        )}

        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            {(humanPlayer.hand || []).map((card: Card) => {
              const canAfford = humanPlayer.energy >= card.energy;
              const isDisabled = !canAct || !canAfford || isProcessing;  // 处理中时禁用所有卡牌

              // 如果正在处理中，给卡牌添加等待样式
              const isPending = isProcessing && pendingAction;

              return (
                <div
                  key={card.uid}
                  className={`relative transition-all duration-200 ${
                    isPending ? 'opacity-60 pointer-events-none' : ''
                  }`}
                >
                  <GameCard
                    card={card}
                    inHand={!isDisabled}
                    disabled={isDisabled}
                    onClick={() => handleCardClick(card)}
                    showSubtype
                  />
                  {/* 等待中遮罩 */}
                  {isPending && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-lg">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
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
                .filter((p) => p.id !== humanPlayerId && !p.eliminated)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleTechLockTargetSelect(p.id)}
                    className="w-full flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg border border-slate-700 transition-colors"
                  >
                    <div className={`w-3 h-3 rounded-full bg-${p.color}-500`} />
                    <div className="flex-1 text-left">
                      <div className="font-bold text-white">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        星系 {p.position} · 手牌 {p.hand?.length ?? 0} 张 · 能量 {p.energy}
                      </div>
                    </div>
                    <span className="text-xs text-red-400">点击锁定</span>
                  </button>
                ))}
            </div>
          ) : (
            // 普通打击：选择星系
            <div className="py-4">
              <OnlineStarMap
                highlightSystems={validStrikeTargets}
                onSystemClick={handleStrikeTargetSelect}
                interactiveMode
              />
            </div>
          )}

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
            <OnlineStarMap
              highlightSystems={validBroadcastTargets}
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

      {/* 防御牌确认对话框 */}
      <Dialog open={defenseDialogOpen} onOpenChange={closeDefenseDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-blue-400">🛡️</span>
              确认部署防御
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              确认要将此防御牌部署到你的文明吗？
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
                  {currentCard.protectionLevel && (
                    <div className="text-xs text-blue-400">
                      防御等级 {currentCard.protectionLevel}
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
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={closeDefenseDialog}>
              取消
            </Button>
            <Button
              variant="default"
              onClick={confirmDeployDefense}
              className="bg-blue-600 hover:bg-blue-700"
            >
              确认部署
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
            <div className="text-sm text-slate-300 mb-3">
              当前手牌（{humanPlayer.hand?.length ?? 0} 张）- 点击选择要弃掉的牌
            </div>
            {humanPlayer.hand?.length === 0 ? (
              <div className="text-center text-slate-500 py-8">
                没有手牌可弃
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto p-2 bg-slate-800/50 rounded-lg">
                {(humanPlayer.hand || []).map((card: Card) => {
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
