import { useState, memo, useCallback, useMemo } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { GameCard, StackedGameCard } from '@/components/game/GameCard';
import { OnlineStarMap } from './OnlineStarMap';
import type { Card, CardType } from '@/lib/game/types';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { getSystemsInRange } from '@/lib/game/starmap';
import { groupCardsByDefId } from '@/lib/game/cards';
import { filterSensitive } from '@/lib/utils/sensitiveFilter';
import { getCachedSensitiveWords } from '@/api/sensitiveWords';
import { getModeRules } from '@/lib/game/modeRules';
import { Recycle, Rocket, Trash2, Zap, Radio, Factory, Shield, Lightbulb, AlertTriangle, Eye, EyeOff, MapPin, MessageSquare, Wallet, Layers } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useDoorCardDisplayMode } from '@/hooks/useDoorCardDisplayMode';

/**
 * 简略模式下，场上门牌按卡牌类型显示的颜色条映射。
 * 与 GameCard 中 TYPE_LABEL_COLORS 的色系保持一致（emerald/red/blue/amber）。
 */
const TYPE_DOT_COLORS: Record<CardType, string> = {
  broadcast: 'bg-emerald-500',
  strike: 'bg-red-500',
  defense: 'bg-blue-500',
  facility: 'bg-amber-500',
};

export const OnlinePlayerHand = memo(() => {
  const gameState = useOnlineGameStore(s => s.gameState);
  const sendAction = useOnlineGameStore(s => s.sendAction);
  const isProcessing = useOnlineGameStore(s => s.isProcessing);
  const pendingAction = useOnlineGameStore(s => s.pendingAction);
  const error = useOnlineGameStore(s => s.error);

  const localPlayerId = useLocalPlayerId();
  const isMobile = useIsMobile();
  // 移动端场上门牌展示模式（默认图文 / 简略文字），全局持久化偏好
  const { mode: doorCardMode } = useDoorCardDisplayMode();

  const { players } = gameState || { players: [] };

  const localPlayerIdFromState = localPlayerId || gameState?.localPlayerId;
  const humanPlayer = players.find(p => p.id === localPlayerIdFromState);

  // 当前对局模式规则：Classic = 一次性手牌直接跃迁；Relics = 先部署后跃迁
  // gameState 类型为 GameState | ViewState，ViewState 无 gameMode 字段，需用 in 守卫收窄
  const modeRules = getModeRules(
    gameState && 'gameMode' in gameState ? gameState.gameMode : undefined
  );

  const canAct = useMemo(() => {
    if (!gameState) return false;
    const { currentPlayerIndex, turnPhase, players } = gameState;
    return players[currentPlayerIndex]?.id === localPlayerIdFromState && turnPhase === 'actionPhase' && !isProcessing;
  }, [gameState, localPlayerIdFromState, isProcessing]);

  const canEndTurn = canAct;

  const [strikeDialogOpen, setStrikeDialogOpen] = useState(false);
  const [broadcastDialogOpen, setBroadcastDialogOpen] = useState(false);
  const [facilityDialogOpen, setFacilityDialogOpen] = useState(false);
  const [defenseDialogOpen, setDefenseDialogOpen] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [lightspeedDialogOpen, setLightspeedDialogOpen] = useState(false);
  // 光速飞船多步表单状态
  const [lightspeedMode, setLightspeedMode] = useState<'random' | 'specified'>('random');
  const [lightspeedTarget, setLightspeedTarget] = useState<number>(-1);
  const [lightspeedCarry, setLightspeedCarry] = useState<number>(0);
  const [lightspeedMessage, setLightspeedMessage] = useState<string>('');
  const [lightspeedLeaveBehind, setLightspeedLeaveBehind] = useState<boolean>(true);
  // 是否将「继承」事件公开至公共游戏日志（由遗留者在跃迁时设定，作用于未来继承者触发继承时的公共日志写入）
  const [lightspeedBroadcastInherit, setLightspeedBroadcastInherit] = useState<boolean>(true);
  // Classic 模式光速飞船：手牌直接跃迁（无留言、无携带能量）
  const [classicLightspeedDialogOpen, setClassicLightspeedDialogOpen] = useState(false);
  const [classicLightspeedMode, setClassicLightspeedMode] = useState<'random' | 'specified'>('random');
  const [classicLightspeedTarget, setClassicLightspeedTarget] = useState<number>(-1);
  const [classicLightspeedLeaveBehind, setClassicLightspeedLeaveBehind] = useState<boolean>(true);
  const [classicLightspeedBroadcastInherit, setClassicLightspeedBroadcastInherit] = useState<boolean>(true);
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [recycleMode, setRecycleMode] = useState(false);
  // 简略模式下，点击"回收"按钮唤起的回收弹窗
  const [recycleDialogOpen, setRecycleDialogOpen] = useState(false);
  const [selectedDiscardCards, setSelectedDiscardCards] = useState<string[]>([]);
  const [keepSecret, setKeepSecret] = useState(false);

  const hasLightspeedShip = useMemo(
    () => humanPlayer?.faceUpCards.some((c: Card) => c.ability === 'escape') ?? false,
    [humanPlayer?.faceUpCards]
  );

  // 玩家所在星系的恒星是否已毁灭。
  // GameState 与 ViewState 均含 destroyedStars: number[]，可直接访问（无需类型窄化）。
  // 本地玩家在 ViewState 中 position 为真实值（仅对手被脱敏为 -1），故 humanPlayer.position 可信。
  // 与后端 settlement.go 的 isStarDestroyed 判定一致：state.DestroyedStars 包含 player.Position。
  const isHomeStarDestroyed = useMemo(() => {
    if (!gameState || !humanPlayer) return false;
    return (gameState.destroyedStars ?? []).includes(humanPlayer.position);
  }, [gameState, humanPlayer]);

  const handleCardClick = useCallback((card: Card) => {
    if (!canAct || !humanPlayer) return;

    // Classic 模式光速飞船：手牌中直接跃迁，合并动作费用由 modeRules 给出（10/13），不依赖 card.energy
    // 用 ability === 'escape' 判断（与后端 cards_actions.go / turn.go / hasLightspeedShip / lightspeedCard 一致），
    // 避免 defId 变更或卡牌变体导致漏判，错误走 deploy 路径被后端拒绝
    const isClassicLightspeed = modeRules.lightspeedUsage === 'oneTime' && card.ability === 'escape';
    const minCost = isClassicLightspeed ? modeRules.lightspeedCombinedActionCost : card.energy;

    if (humanPlayer.energy < minCost) {
      toast.error('能量不足', { description: `需要 ${minCost} 点能量，当前只有 ${humanPlayer.energy} 点` });
      return;
    }

    switch (card.type) {
      case 'defense': setCurrentCard(card); setDefenseDialogOpen(true); break;
      case 'facility':
        if (isClassicLightspeed) {
          // Classic：手牌直接跃迁，打开专用弹窗（无留言、无携带能量）
          setCurrentCard(card);
          setClassicLightspeedMode('random');
          setClassicLightspeedTarget(-1);
          setClassicLightspeedLeaveBehind(true);
          setClassicLightspeedBroadcastInherit(true);
          setClassicLightspeedDialogOpen(true);
        } else {
          // Relics / 其他设施：先部署到 FaceUpCards
          setCurrentCard(card);
          setFacilityDialogOpen(true);
        }
        break;
      case 'strike': setCurrentCard(card); setStrikeDialogOpen(true); break;
      case 'broadcast': setCurrentCard(card); setBroadcastDialogOpen(true); break;
    }
  }, [canAct, humanPlayer, modeRules]);

  const confirmDeployDefense = useCallback(() => {
    if (!currentCard) return;
    sendAction('deployCard', { cardUid: currentCard.uid });
    toast.success('防御牌部署成功', { description: `【${currentCard.name}】已部署到你的文明` });
    setDefenseDialogOpen(false);
    setCurrentCard(null);
  }, [currentCard, sendAction]);

  const closeDefenseDialog = useCallback(() => { setDefenseDialogOpen(false); setCurrentCard(null); }, []);

  const confirmDeployFacility = useCallback(() => {
    if (!currentCard) return;
    sendAction('deployCard', { cardUid: currentCard.uid });
    toast.success('设施部署成功', { description: `【${currentCard.name}】已部署到你的文明` });
    setFacilityDialogOpen(false);
    setCurrentCard(null);
  }, [currentCard, sendAction]);

  const closeFacilityDialog = useCallback(() => { setFacilityDialogOpen(false); setCurrentCard(null); }, []);

  const handleRecycleClick = useCallback((card: Card) => {
    if (!canAct || !recycleMode) return;
    sendAction('recycleCard', { cardUid: card.uid });
    setRecycleMode(false);
    toast.success('卡牌已回收', { description: `【${card.name}】已回收，获得 50% 能量返还` });
  }, [canAct, recycleMode, sendAction]);

  // 简略模式下，从回收弹窗中点击单张卡牌回收。
  // 不依赖 recycleMode 状态，回收后关闭弹窗。
  const handleRecycleFromDialog = useCallback((card: Card) => {
    if (!canAct) return;
    sendAction('recycleCard', { cardUid: card.uid });
    setRecycleDialogOpen(false);
    toast.success('卡牌已回收', { description: `【${card.name}】已回收，获得 50% 能量返还` });
  }, [canAct, sendAction]);

  const handleStrikeTargetSelect = useCallback((systemId: number) => {
    if (!currentCard) return;
    sendAction('strike', { cardUid: currentCard.uid, targetSystem: systemId });
    setStrikeDialogOpen(false);
    setCurrentCard(null);
    toast.success('打击已发射', { description: `飞向星系 ${systemId}` });
  }, [currentCard, sendAction]);

  const handleTechLockTargetSelect = useCallback((targetPlayerId: string) => {
    if (!currentCard || !humanPlayer) return;
    const targetPlayer = players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) return;
    sendAction('strike', { cardUid: currentCard.uid, targetSystem: targetPlayer.position, targetPlayerId });
    setStrikeDialogOpen(false);
    setCurrentCard(null);
    toast.success('科技锁死已发动', { description: `目标：${targetPlayer.name}` });
  }, [currentCard, humanPlayer, players, sendAction]);

  const handleBroadcastTargetSelect = useCallback((systemId: number) => {
    if (!currentCard) return;
    sendAction('broadcast', { cardUid: currentCard.uid, targetSystem: systemId });
    setBroadcastDialogOpen(false);
    setCurrentCard(null);
    toast.success('广播已发送', { description: `目标星系 ${systemId}` });
  }, [currentCard, sendAction]);

  const handleEndTurn = useCallback(() => {
    sendAction('endTurn', { discardCards: selectedDiscardCards, publicDiscard: !keepSecret });
    setDiscardDialogOpen(false);
    setSelectedDiscardCards([]);
    setKeepSecret(false);
  }, [selectedDiscardCards, keepSecret, sendAction]);

  const toggleDiscardCard = useCallback((cardUid: string) => {
    setSelectedDiscardCards(prev => prev.includes(cardUid) ? prev.filter(uid => uid !== cardUid) : [...prev, cardUid]);
  }, []);

  const validStrikeTargets = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8, 9], []);

  const validBroadcastTargets = useMemo(() => {
    if (!currentCard || currentCard.type !== 'broadcast') return [];
    if (!humanPlayer) return [];
    const range = currentCard.range ?? 1;
    // 允许向自身所在星系广播（自身不作为回应者，其余规则不变）
    if (range >= 100) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const targets = getSystemsInRange(humanPlayer.position, range);
    return [...targets, humanPlayer.position];
  }, [currentCard, humanPlayer]);

  // 光速飞船卡牌（场上的 escape 设施，可重复使用）
  const lightspeedCard = useMemo(
    () => humanPlayer?.faceUpCards.find((c: Card) => c.ability === 'escape') ?? null,
    [humanPlayer?.faceUpCards]
  );

  // 跃迁费用：random / specified 两档，由 modeRules 给出（Relics=3/5）；留言额外 1 能量
  const lightspeedJumpCost = lightspeedMode === 'random'
    ? modeRules.lightspeedJumpCostRandom
    : modeRules.lightspeedJumpCostSpecified;
  const lightspeedMessageCost = (modeRules.lightspeedMessageEnabled && lightspeedMessage.trim()) ? 1 : 0;
  const lightspeedTotalCost = lightspeedJumpCost + lightspeedMessageCost;
  // 剩余可用于携带的能量：下界 0
  const lightspeedRemainingEnergy = humanPlayer
    ? Math.max(0, humanPlayer.energy - lightspeedTotalCost)
    : 0;
  // 携带上限：min(modeRules.lightspeedCarryCap, 剩余能量)
  const lightspeedMaxCarry = Math.min(modeRules.lightspeedCarryCap, lightspeedRemainingEnergy);

  // 指定模式可选目标：1-9，排除当前玩家位置与已知占用星球（position >= 1）
  const lightspeedValidTargets = useMemo(() => {
    if (!humanPlayer) return [];
    const occupied = new Set<number>();
    for (const p of players) {
      if (p.position >= 1) occupied.add(p.position);
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(s => !occupied.has(s));
  }, [humanPlayer, players]);

  // 留言过滤预览：词表未加载时降级为不过滤，避免空词表导致与原文相同
  const lightspeedWords = getCachedSensitiveWords();
  const lightspeedMessagePreview = (lightspeedMessage && lightspeedWords)
    ? filterSensitive(lightspeedMessage, lightspeedWords)
    : (lightspeedMessage ?? '');
  const lightspeedMessageFiltered = lightspeedMessagePreview !== lightspeedMessage;

  const handleUseLightspeedShip = useCallback(() => {
    if (!humanPlayer) return;
    if (!lightspeedCard) return;
    // 最低 random 模式跃迁费用（Relics=3），由 modeRules 给出
    if (humanPlayer.energy < modeRules.lightspeedJumpCostRandom) {
      toast.error('能量不足', { description: `至少需要 ${modeRules.lightspeedJumpCostRandom} 点能量发动光速飞船（随机跃迁）` });
      return;
    }
    // 重置表单状态为默认值
    setLightspeedMode('random');
    setLightspeedTarget(-1);
    setLightspeedCarry(0);
    setLightspeedMessage('');
    setLightspeedLeaveBehind(true);
    setLightspeedBroadcastInherit(true);
    setLightspeedDialogOpen(true);
  }, [humanPlayer, lightspeedCard, modeRules]);

  const confirmLightspeedShip = useCallback(() => {
    if (!humanPlayer || !lightspeedCard) return;
    // 前置能量校验
    if (humanPlayer.energy < lightspeedTotalCost) {
      toast.error('能量不足', { description: `需要 ${lightspeedTotalCost} 点能量，当前 ${humanPlayer.energy} 点` });
      return;
    }
    // 指定模式必须选目标
    if (lightspeedMode === 'specified' && lightspeedTarget < 1) {
      toast.error('请选择目标星系', { description: '指定跃迁模式需要选择一个目标星球' });
      return;
    }
    // 携带量校验
    if (lightspeedCarry > lightspeedMaxCarry) {
      toast.error('携带能量超出上限', { description: `最多可携带 ${lightspeedMaxCarry} 点能量` });
      return;
    }
    const trimmedMessage = lightspeedMessage.trim();
    // 词表未加载时降级为发送原文（不过滤），避免空词表误清空留言
    const words = getCachedSensitiveWords();
    const filteredMessage = (trimmedMessage && words)
      ? filterSensitive(trimmedMessage, words)
      : trimmedMessage;
    sendAction('lightspeedShip', {
      cardUid: lightspeedCard.uid,
      mode: lightspeedMode,
      targetSystem: lightspeedMode === 'specified' ? lightspeedTarget : 0,
      carryEnergy: lightspeedCarry,
      message: filteredMessage,
      leaveBehind: lightspeedLeaveBehind,
      broadcastOnInherit: lightspeedLeaveBehind ? lightspeedBroadcastInherit : undefined,
    });
    setLightspeedDialogOpen(false);
    const modeText = lightspeedMode === 'random' ? '随机跃迁（位置不公开）' : `指定跃迁至星系 ${lightspeedTarget}（位置公开）`;
    const carryText = lightspeedCarry > 0 ? `携带 ${lightspeedCarry} 能量` : '不携带能量';
    const leaveText = lightspeedLeaveBehind ? '余下能量与设施遗留原星球' : '余下能量与设施销毁';
    const inheritText = lightspeedLeaveBehind
      ? (lightspeedBroadcastInherit ? '继承事件公开至游戏日志' : '继承事件保密')
      : '';
    toast.success('光速飞船已启动', {
      description: `${modeText}；${carryText}；${leaveText}${filteredMessage ? '；附留言' : ''}${inheritText ? '；' + inheritText : ''}`,
    });
  }, [
    humanPlayer,
    lightspeedCard,
    lightspeedTotalCost,
    lightspeedMode,
    lightspeedTarget,
    lightspeedCarry,
    lightspeedMaxCarry,
    lightspeedMessage,
    lightspeedLeaveBehind,
    lightspeedBroadcastInherit,
    sendAction,
  ]);

  // 切换模式时重置携带量与目标，避免残留状态
  const handleLightspeedModeChange = useCallback((mode: 'random' | 'specified') => {
    setLightspeedMode(mode);
    setLightspeedTarget(-1);
    setLightspeedCarry(0);
  }, []);

  // ===== Classic 模式光速飞船（手牌直接跃迁） =====
  // Classic 模式可选目标：1-9，排除当前玩家位置
  const classicLightspeedValidTargets = useMemo(() => {
    if (!humanPlayer) return [];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(s => s !== humanPlayer.position);
  }, [humanPlayer]);

  // Classic 模式跃迁费用：随机 10 / 指定 13
  const classicLightspeedCost = classicLightspeedMode === 'random'
    ? modeRules.lightspeedCombinedActionCost
    : modeRules.lightspeedCombinedActionCostSpecified;

  // 切换 Classic 模式时重置目标
  const handleClassicLightspeedModeChange = useCallback((mode: 'random' | 'specified') => {
    setClassicLightspeedMode(mode);
    setClassicLightspeedTarget(-1);
  }, []);

  const closeClassicLightspeedDialog = useCallback(() => {
    setClassicLightspeedDialogOpen(false);
    setCurrentCard(null);
  }, []);

  const confirmClassicLightspeedShip = useCallback(() => {
    if (!currentCard) return;
    // 能量校验
    if (humanPlayer && humanPlayer.energy < classicLightspeedCost) {
      toast.error('能量不足', { description: `需要 ${classicLightspeedCost} 点能量，当前 ${humanPlayer.energy} 点` });
      return;
    }
    // 指定模式必须选目标
    if (classicLightspeedMode === 'specified' && classicLightspeedTarget < 1) {
      toast.error('请选择目标星系', { description: '指定跃迁模式需要选择一个目标星球' });
      return;
    }
    // Classic 模式：无留言、无携带能量，cardUid 指手牌中的飞船
    sendAction('lightspeedShip', {
      cardUid: currentCard.uid,
      mode: classicLightspeedMode,
      targetSystem: classicLightspeedMode === 'specified' ? classicLightspeedTarget : 0,
      carryEnergy: 0,
      message: '',
      leaveBehind: classicLightspeedLeaveBehind,
      broadcastOnInherit: classicLightspeedLeaveBehind ? classicLightspeedBroadcastInherit : undefined,
    });
    setClassicLightspeedDialogOpen(false);
    setCurrentCard(null);
    const modeText = classicLightspeedMode === 'random'
      ? `随机跃迁（${classicLightspeedCost}能量，位置不公开）`
      : `指定跃迁至星系 ${classicLightspeedTarget}（${classicLightspeedCost}能量，位置公开）`;
    const leaveText = classicLightspeedLeaveBehind ? '余下能量与设施遗留原星球' : '余下能量与设施销毁';
    const inheritText = classicLightspeedLeaveBehind
      ? (classicLightspeedBroadcastInherit ? '继承事件公开至游戏日志' : '继承事件保密')
      : '';
    toast.success('光速飞船已启动', {
      description: `${modeText}；${leaveText}${inheritText ? '；' + inheritText : ''}`,
    });
  }, [
    currentCard,
    humanPlayer,
    classicLightspeedCost,
    classicLightspeedMode,
    classicLightspeedTarget,
    classicLightspeedLeaveBehind,
    classicLightspeedBroadcastInherit,
    sendAction,
  ]);

  if (!gameState) return null;
  if (!humanPlayer || humanPlayer.eliminated) return null;

  return (
    <>
      {/* ===== 桌面端行动栏（>= 768px）：保持原布局 ===== */}
      {canEndTurn && !isMobile && (
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-slate-900/90 border-t border-slate-700/50 flex-wrap">
          <span className="text-xs text-slate-400 mr-2">行动：</span>
          <span className="text-xs text-slate-500"><Lightbulb className="w-3.5 h-3.5 mr-1" /> 直接点击手牌中的卡牌来使用</span>
          <Button size="sm" variant={recycleMode ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setRecycleMode(!recycleMode)} disabled={!canAct}>
            <Recycle className="w-3.5 h-3.5 mr-1" /> 回收门牌
          </Button>
          {hasLightspeedShip && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-purple-400 border-purple-500/50" onClick={handleUseLightspeedShip} disabled={!canAct} title={`光速飞船：随机(${modeRules.lightspeedJumpCostRandom}能量)/指定(${modeRules.lightspeedJumpCostSpecified}能量)跃迁，可携带0-${modeRules.lightspeedCarryCap}能量${modeRules.lightspeedMessageEnabled ? '，可选≤10字符留言(+1能量)' : ''}，余下遗留或销毁`}>
              <Rocket className="w-3.5 h-3.5 mr-1" /> 光速飞船
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={() => { setSelectedDiscardCards([]); setDiscardDialogOpen(true); }}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> 弃牌结束
          </Button>
        </div>
      )}

      {/* ===== 移动端行动栏（< 768px）：固定底部 3 等分按钮，44px 触屏热区 ===== */}
      {canEndTurn && isMobile && (
        <div className="md:hidden grid grid-cols-3 gap-1 px-2 py-1.5 bg-slate-900/90 border-t border-slate-700/50">
          <Button
            variant={recycleMode || recycleDialogOpen ? 'default' : 'outline'}
            className="h-11 text-xs flex flex-col items-center justify-center gap-0.5"
            onClick={() => {
              if (doorCardMode === 'simple') {
                setRecycleDialogOpen(true);
              } else {
                setRecycleMode(!recycleMode);
              }
            }}
            disabled={!canAct}
          >
            <Recycle className="w-4 h-4" />
            <span className="text-[10px]">回收</span>
          </Button>
          {hasLightspeedShip && (
            <Button
              variant="outline"
              className="h-11 text-xs text-purple-400 border-purple-500/50 flex flex-col items-center justify-center gap-0.5"
              onClick={handleUseLightspeedShip}
              disabled={!canAct}
              title={`光速飞船：随机(${modeRules.lightspeedJumpCostRandom}能量)/指定(${modeRules.lightspeedJumpCostSpecified}能量)跃迁`}
            >
              <Rocket className="w-4 h-4" />
              <span className="text-[10px]">跃迁</span>
            </Button>
          )}
          {!hasLightspeedShip && (
            <div className="h-11 flex items-center justify-center text-[10px] text-slate-600">无跃迁</div>
          )}
          <Button
            variant={canAct ? 'default' : 'outline'}
            className={`h-11 text-xs flex flex-col items-center justify-center gap-0.5 ${canAct ? 'bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700' : ''}`}
            onClick={() => { setSelectedDiscardCards([]); setDiscardDialogOpen(true); }}
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-[10px]">弃牌</span>
          </Button>
        </div>
      )}

      {recycleMode && (
        <div className="px-4 max-md:px-2 py-1.5 bg-slate-800/80 border-t border-slate-700/50">
          <p className="text-xs text-center text-slate-300"><Recycle className="w-3.5 h-3.5 mr-1" /> 回收模式：点击场上的门牌来回收（获得 50% 能量返还）</p>
        </div>
      )}

      {/* ===== 移动端信息条：能量/星系/手牌数（从 OnlineBoard 子头部移过来） ===== */}
      {isMobile && humanPlayer && (
        <div className="md:hidden flex items-center justify-between px-3 py-1 bg-slate-900/60 border-t border-slate-800/30 text-[10px]">
          <span className="text-yellow-500 flex items-center gap-1"><Zap className="w-3 h-3" /> {humanPlayer.energy}</span>
          <span className="text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> 星系 {humanPlayer.position}</span>
          <span className="text-slate-400 flex items-center gap-1"><Layers className="w-3 h-3" /> {humanPlayer.hand?.length ?? 0}</span>
        </div>
      )}

      {isMobile ? (
        // ===== 移动端：门牌区与手牌区横向同行布局 =====
        <div className="px-2 py-2 flex gap-2 items-stretch">
          {/* 左侧：手牌区（占剩余宽度，可横向滚动） */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-500">手牌 ({humanPlayer.hand?.length ?? 0}张)</span>
              <span className="text-[10px] text-yellow-500 flex items-center gap-1"><Zap className="w-3 h-3" /> {humanPlayer.energy}</span>
            </div>

            {isProcessing && pendingAction && (
              <div className="mb-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-yellow-300">等待服务器响应...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-2 px-3 py-1.5 bg-red-900/30 border border-red-700/50 rounded-lg">
                <span className="text-xs text-red-300">❌ {error}</span>
              </div>
            )}

            <ScrollArea className="w-full">
              <div className="flex gap-2 pb-2">
                {(humanPlayer.hand || []).map((card: Card) => {
                  const canAfford = humanPlayer.energy >= card.energy;
                  const isDisabled = !canAct || !canAfford || isProcessing;
                  const isPending = isProcessing && pendingAction;
                  return (
                    <div key={card.uid} className={`relative transition-all duration-200 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
                      <GameCard card={card} inHand={!isDisabled} disabled={isDisabled} onClick={() => handleCardClick(card)} showSubtype />
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

          {/* 右侧：门牌区（仅当有门牌时显示，按 doorCardMode 切换样式） */}
          {humanPlayer.faceUpCards.length > 0 && (
            doorCardMode === 'default' ? (
              // 默认模式：图文卡牌，从右向左排列（flex-row-reverse），靠右
              <div className="flex-none max-w-[45%] flex flex-col">
                <div className="text-[10px] text-slate-500 mb-1 shrink-0">
                  门牌{recycleMode ? '（点击回收）' : ''}
                </div>
                <div className="flex flex-row-reverse gap-1.5 overflow-x-auto pb-1">
                  {recycleMode ? (
                    humanPlayer.faceUpCards.map((card: Card) => (
                      <GameCard key={card.uid} card={card} onClick={() => handleRecycleClick(card)} selected disabled={!canAct} />
                    ))
                  ) : (
                    groupCardsByDefId(humanPlayer.faceUpCards).map(({ card, count }) => (
                      <StackedGameCard key={card.defId} card={card} count={count} />
                    ))
                  )}
                </div>
              </div>
            ) : (
              // 简略模式：文字列表，按 defId 分组，每类一行，列满再开新列
              <div className="flex-none w-36 flex flex-col">
                <div className="text-[10px] text-slate-500 mb-1 shrink-0">门牌</div>
                <div className="grid grid-flow-col grid-rows-4 gap-x-2 gap-y-0.5 text-[11px] text-slate-300 auto-cols-max">
                  {groupCardsByDefId(humanPlayer.faceUpCards).map(({ card, count }) => (
                    <div key={card.defId} className="flex items-center gap-1 whitespace-nowrap">
                      <span className={`w-1 h-3 rounded-sm shrink-0 ${TYPE_DOT_COLORS[card.type]}`} />
                      <span>{card.name}</span>
                      <span className="text-slate-500">×{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        // ===== 桌面端：保持原有垂直堆叠布局 =====
        <>
          {humanPlayer.faceUpCards.length > 0 && (
            <div className="px-4 pt-2 pb-1">
              <div className="text-[10px] text-slate-500 mb-1">场上门牌{recycleMode ? '（点击可回收）' : ''}</div>
              {recycleMode ? (
                // 回收模式：保持平铺，每张牌可独立点击回收
                <div className="flex gap-1.5">
                  {humanPlayer.faceUpCards.map((card: Card) => (
                    <GameCard key={card.uid} card={card} compact onClick={() => handleRecycleClick(card)} selected disabled={!canAct} />
                  ))}
                </div>
              ) : (
                // 非回收模式：相同门牌按 defId 堆叠显示
                <div className="flex gap-1.5">
                  {groupCardsByDefId(humanPlayer.faceUpCards).map(({ card, count }) => (
                    <StackedGameCard key={card.defId} card={card} count={count} compact />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="px-4 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-500">手牌 ({humanPlayer.hand?.length ?? 0}张)</span>
              <span className="text-[10px] text-yellow-500 flex items-center gap-1"><Zap className="w-3 h-3" /> {humanPlayer.energy} 能量</span>
            </div>

            {isProcessing && pendingAction && (
              <div className="mb-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-yellow-300">等待服务器响应...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-2 px-3 py-1.5 bg-red-900/30 border border-red-700/50 rounded-lg">
                <span className="text-xs text-red-300">❌ {error}</span>
              </div>
            )}

            <ScrollArea className="w-full">
              <div className="flex gap-2 pb-2">
                {(humanPlayer.hand || []).map((card: Card) => {
                  const canAfford = humanPlayer.energy >= card.energy;
                  const isDisabled = !canAct || !canAfford || isProcessing;
                  const isPending = isProcessing && pendingAction;
                  return (
                    <div key={card.uid} className={`relative transition-all duration-200 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
                      <GameCard card={card} inHand={!isDisabled} disabled={isDisabled} onClick={() => handleCardClick(card)} showSubtype />
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
        </>
      )}

      <Dialog open={strikeDialogOpen} onOpenChange={setStrikeDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-red-400" />{currentCard?.effect === 'discard_hand' ? '选择科技锁死目标' : '选择打击目标星系'}</DialogTitle>
            <DialogDescription className="text-slate-400">{currentCard?.effect === 'discard_hand' ? '选择一个文明进行科技锁死，打击牌将追踪目标' : '选择打击目标星系，打击牌将飞向该星系'}</DialogDescription>
            {currentCard && (
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-red-500/20 text-red-300 border-0">{currentCard.name}</Badge>
                <span className="text-yellow-400 flex items-center gap-0.5"><Zap className="w-3.5 h-3.5" />{currentCard.energy}</span>
                {currentCard.level && <span className="text-red-400">Lv.{currentCard.level}</span>}
              </div>
            )}
          </DialogHeader>
          {currentCard?.effect === 'discard_hand' ? (
            <div className="py-4 space-y-2">
              <p className="text-xs text-slate-400">可锁定的文明：</p>
              {players.filter(p => p.id !== localPlayerIdFromState && !p.eliminated).map(p => (
                <button key={p.id} onClick={() => handleTechLockTargetSelect(p.id)} className="w-full flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg border border-slate-700 transition-colors">
                  <div className={`w-3 h-3 rounded-full bg-${p.color}-500`} />
                  <div className="flex-1 text-left">
                    <div className="font-bold text-white">{p.name}</div>
                    <div className="text-xs text-slate-400">手牌 {'handCount' in p ? p.handCount : (p.hand?.length ?? 0)} 张 · 能量 {p.energy}</div>
                  </div>
                  <span className="text-xs text-red-400">点击锁定</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-4"><OnlineStarMap highlightSystems={validStrikeTargets} onSystemClick={handleStrikeTargetSelect} interactiveMode /></div>
          )}
          <DialogFooter><Button variant="ghost" onClick={() => setStrikeDialogOpen(false)}>取消</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={broadcastDialogOpen} onOpenChange={setBroadcastDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Radio className="w-5 h-5 text-emerald-400" />选择广播目标星系</DialogTitle>
            <DialogDescription className="text-slate-400">选择广播目标星系</DialogDescription>
            {currentCard && (
              <div className="flex items-center gap-2 mt-1">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-0">{currentCard.name}</Badge>
                <span className="text-yellow-400 flex items-center gap-0.5"><Zap className="w-3.5 h-3.5" />{currentCard.energy}</span>
                {currentCard.subtype && <Badge className={currentCard.subtype === 'cooperation' ? 'bg-green-500/20 text-green-300 border-0' : 'bg-orange-500/20 text-orange-300 border-0'}>{currentCard.subtype === 'cooperation' ? '合作' : '伪装'}</Badge>}
                {currentCard.range && currentCard.range < 100 && <span className="text-emerald-400">范围 {currentCard.range}</span>}
                {currentCard.range && currentCard.range >= 100 && <span className="text-emerald-400">无限范围</span>}
              </div>
            )}
          </DialogHeader>
          <div className="py-4"><OnlineStarMap highlightSystems={validBroadcastTargets} onSystemClick={handleBroadcastTargetSelect} interactiveMode /></div>
          <DialogFooter><Button variant="ghost" onClick={() => setBroadcastDialogOpen(false)}>取消</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={facilityDialogOpen} onOpenChange={closeFacilityDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Factory className="w-5 h-5 text-cyan-400" />确认部署设施</DialogTitle>
            <DialogDescription className="text-slate-400">确认要将此设施部署到你的文明吗？</DialogDescription>
          </DialogHeader>
          {currentCard && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                <div className="flex-1"><div className="font-bold text-white">{currentCard.name}</div><div className="text-xs text-slate-400 mt-1">{currentCard.description}</div></div>
                <div className="text-right"><div className="text-yellow-400 font-bold flex items-center gap-1"><Zap className="w-4 h-4" /> {currentCard.energy}</div>{currentCard.energyPerTurn && <div className="text-xs text-emerald-400">+{currentCard.energyPerTurn} 能量/回合</div>}</div>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                <span className="text-sm text-slate-400">当前能量</span>
                <span className={`text-lg font-bold ${humanPlayer.energy >= currentCard.energy ? 'text-emerald-400' : 'text-red-400'}`}><Zap className="w-5 h-5 inline" /> {humanPlayer.energy}</span>
              </div>
              {currentCard.defId === 'facility_dyson_sphere' && <div className="p-2 bg-amber-950/30 border border-amber-900/50 rounded text-xs text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 注意：每个星系只能建造 1 个戴森球</div>}
              {isHomeStarDestroyed && (currentCard.defId === 'facility_solar_array' || currentCard.defId === 'facility_dyson_sphere') && (
                <div className="p-2 bg-red-950/30 border border-red-900/50 rounded text-xs text-red-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>你所在星系的恒星已被毁灭，此设施每回合不会产出能量（与后端 settlement.go 的恒星依赖判定一致）。仍可部署，但结算时将失效。</span>
                </div>
              )}
              {currentCard.defId === 'facility_lightspeed_ship' && (
                <div className="p-2 bg-purple-950/30 border border-purple-900/50 rounded text-xs text-purple-300 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {modeRules.lightspeedUsage === 'oneTime'
                    ? '一次性牌：从手牌直接跃迁。随机（10能量，不公开位置）或指定（13能量，公开位置）。不可携带能量，无留言，跃迁后进弃牌堆。余下能量与设施选择遗留或销毁。'
                    : '可重复使用。跃迁模式二选一：随机（3能量，不公开位置）或指定（5能量，公开位置）。可携带0-5点能量至新星球，余下能量选择遗留或销毁。可填写≤10字符留言（额外1能量）。'}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={closeFacilityDialog}>取消</Button>
            <Button variant="default" onClick={confirmDeployFacility} className="bg-cyan-600 hover:bg-cyan-700">确认部署</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={defenseDialogOpen} onOpenChange={closeDefenseDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-blue-400" />确认部署防御</DialogTitle>
            <DialogDescription className="text-slate-400">确认要将此防御牌部署到你的文明吗？</DialogDescription>
          </DialogHeader>
          {currentCard && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                <div className="flex-1"><div className="font-bold text-white">{currentCard.name}</div><div className="text-xs text-slate-400 mt-1">{currentCard.description}</div></div>
                <div className="text-right"><div className="text-yellow-400 font-bold flex items-center gap-1"><Zap className="w-4 h-4" /> {currentCard.energy}</div>{currentCard.protectionLevel && <div className="text-xs text-blue-400">防御等级 {currentCard.protectionLevel}</div>}</div>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                <span className="text-sm text-slate-400">当前能量</span>
                <span className={`text-lg font-bold ${humanPlayer.energy >= currentCard.energy ? 'text-emerald-400' : 'text-red-400'}`}><Zap className="w-5 h-5 inline" /> {humanPlayer.energy}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={closeDefenseDialog}>取消</Button>
            <Button variant="default" onClick={confirmDeployDefense} className="bg-blue-600 hover:bg-blue-700">确认部署</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardDialogOpen} onOpenChange={(open) => { setDiscardDialogOpen(open); if (!open) setKeepSecret(false); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Trash2 className="w-5 h-5 text-slate-400" />弃牌结束回合</DialogTitle>
            <DialogDescription className="text-slate-400">选择要弃掉的手牌，然后结束回合。也可以不弃牌直接结束。</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="text-sm text-slate-300 mb-3">当前手牌（{humanPlayer.hand?.length ?? 0} 张）- 点击选择要弃掉的牌</div>
            {humanPlayer.hand?.length === 0 ? (
              <div className="text-center text-slate-500 py-8">没有手牌可弃</div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-64 max-md:max-h-[50vh] overflow-y-auto p-2 bg-slate-800/50 rounded-lg">
                {(humanPlayer.hand || []).map((card: Card) => {
                  const isSelected = selectedDiscardCards.includes(card.uid);
                  return (
                    <div key={card.uid} className={`cursor-pointer transition-all duration-200 ${isSelected ? 'opacity-50 scale-95' : 'hover:scale-105'}`} onClick={() => toggleDiscardCard(card.uid)} role="button" aria-label={`选择弃掉 ${card.name}`} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDiscardCard(card.uid); } }}>
                      <GameCard card={card} compact selected={isSelected} showSubtype />
                    </div>
                  );
                })}
              </div>
            )}
            {selectedDiscardCards.length > 0 && <div className="mt-3 text-sm text-slate-400">已选择 <span className="text-yellow-400 font-bold">{selectedDiscardCards.length}</span> 张牌</div>}

            <div className="mt-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {keepSecret ? <EyeOff className="w-4 h-4 text-amber-400" /> : <Eye className="w-4 h-4 text-emerald-400" />}
                  <div>
                    <div className="text-sm font-medium text-slate-200">{keepSecret ? '保密' : '公开'}</div>
                    <div className="text-xs text-slate-400">{keepSecret ? '其他玩家看不到弃牌内容' : '其他玩家也能看到弃掉的牌'}</div>
                  </div>
                </div>
                <button onClick={() => setKeepSecret(!keepSecret)} className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${keepSecret ? 'bg-amber-600' : 'bg-emerald-600'}`} role="switch" aria-checked={keepSecret}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${keepSecret ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardDialogOpen(false)}>取消</Button>
            <Button variant="default" onClick={handleEndTurn} className="bg-slate-600 hover:bg-slate-700">
              {selectedDiscardCards.length > 0 ? `弃掉 ${selectedDiscardCards.length} 张牌并结束` : '直接结束回合'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lightspeedDialogOpen} onOpenChange={setLightspeedDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Rocket className="w-5 h-5 text-purple-400" />光速飞船 — 跃迁抉择</DialogTitle>
            <DialogDescription className="text-slate-400">
              可重复使用。跃迁模式二选一：随机（{modeRules.lightspeedJumpCostRandom}能量，不公开位置）或指定（{modeRules.lightspeedJumpCostSpecified}能量，公开位置）。可携带 0-{modeRules.lightspeedCarryCap} 点能量至新星球，余下能量选择遗留或销毁。{modeRules.lightspeedMessageEnabled ? '可填写 ≤10 字符留言（额外 1 能量），继承者私有揭示可见。' : '此模式不支持留言。'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 max-md:space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {/* 步骤 a：跃迁模式选择 */}
            <div className="space-y-2">
              <Label className="text-slate-300"><Rocket className="w-4 h-4 text-purple-400" /> 跃迁模式</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleLightspeedModeChange('random')}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${lightspeedMode === 'random' ? 'bg-purple-900/40 border-purple-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-purple-200">随机跃迁</span>
                  <span className="text-xs text-slate-400">3 能量 · 位置不公开</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleLightspeedModeChange('specified')}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${lightspeedMode === 'specified' ? 'bg-amber-900/40 border-amber-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-amber-200">指定跃迁</span>
                  <span className="text-xs text-slate-400">5 能量 · 位置公开</span>
                </button>
              </div>
            </div>

            {/* 步骤 b：指定模式下的目标星球选择 */}
            {lightspeedMode === 'specified' && (
              <div className="space-y-2">
                <Label className="text-slate-300"><MapPin className="w-4 h-4 text-amber-400" /> 目标星系</Label>
                <Select
                  value={lightspeedTarget >= 1 ? String(lightspeedTarget) : ''}
                  onValueChange={(v) => setLightspeedTarget(Number(v))}
                >
                  <SelectTrigger className="w-full bg-slate-800/50 border-slate-700 text-white">
                    <SelectValue placeholder="选择目标星球（1-9，排除已占用）" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {lightspeedValidTargets.map(s => (
                      <SelectItem key={s} value={String(s)}>星系 {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lightspeedValidTargets.length === 0 && (
                  <p className="text-xs text-red-400">没有可选目标星系</p>
                )}
              </div>
            )}

            {/* 步骤 c：携带能量数 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300"><Wallet className="w-4 h-4 text-yellow-400" /> 携带能量</Label>
                <span className="text-sm text-yellow-400 font-bold">{lightspeedCarry} / {lightspeedMaxCarry}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setLightspeedCarry(Math.max(0, lightspeedCarry - 1))}
                  disabled={lightspeedMaxCarry === 0 || lightspeedCarry <= 0}
                  aria-label="减少携带能量"
                >
                  -
                </Button>
                <Slider
                  min={0}
                  max={Math.max(0, lightspeedMaxCarry)}
                  value={[Math.min(lightspeedCarry, lightspeedMaxCarry)]}
                  onValueChange={(v) => setLightspeedCarry(v[0] ?? 0)}
                  disabled={lightspeedMaxCarry === 0}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setLightspeedCarry(Math.min(lightspeedMaxCarry, lightspeedCarry + 1))}
                  disabled={lightspeedMaxCarry === 0 || lightspeedCarry >= lightspeedMaxCarry}
                  aria-label="增加携带能量"
                >
                  +
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                剩余可携带：{lightspeedRemainingEnergy} 点（当前能量 {humanPlayer.energy} − 跃迁费 {lightspeedJumpCost} − 留言费 {lightspeedMessageCost}）。携带上限 {modeRules.lightspeedCarryCap}。
              </p>
            </div>

            {/* 步骤 d：留言输入（仅当模式启用留言时渲染，由 modeRules.lightspeedMessageEnabled 控制） */}
            {modeRules.lightspeedMessageEnabled && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300"><MessageSquare className="w-4 h-4 text-cyan-400" /> 留言（可选，+1 能量）</Label>
                <span className={`text-xs ${lightspeedMessage.length >= 10 ? 'text-amber-400' : 'text-slate-500'}`}>{lightspeedMessage.length}/10</span>
              </div>
              <Input
                type="text"
                maxLength={10}
                value={lightspeedMessage}
                onChange={(e) => setLightspeedMessage(e.target.value)}
                placeholder="留给继承者的留言，最多 10 字符"
                className="bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500"
              />
              {lightspeedMessageFiltered && (
                <p className="text-xs text-amber-300/80">
                  敏感词过滤预览：<span className="italic">{lightspeedMessagePreview}</span>
                </p>
              )}
            </div>
            )}

            {/* 步骤 e：遗留/销毁二选一 */}
            <div className="space-y-2">
              <Label className="text-slate-300"><AlertTriangle className="w-4 h-4 text-orange-400" /> 余下能量与设施</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLightspeedLeaveBehind(true)}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${lightspeedLeaveBehind ? 'bg-purple-900/40 border-purple-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-purple-200">遗留</span>
                  <span className="text-xs text-slate-400">余下能量与设施留原星球，供继承</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightspeedLeaveBehind(false)}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${!lightspeedLeaveBehind ? 'bg-red-900/40 border-red-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-red-200">销毁</span>
                  <span className="text-xs text-slate-400">设施进弃牌堆，能量流失</span>
                </button>
              </div>
            </div>

            {/* 步骤 f：继承事件公开开关（仅在「遗留」时显示） */}
            {lightspeedLeaveBehind && (
              <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {lightspeedBroadcastInherit ? <Eye className="w-4 h-4 text-emerald-400" /> : <EyeOff className="w-4 h-4 text-amber-400" />}
                    <div>
                      <div className="text-sm font-medium text-slate-200">{lightspeedBroadcastInherit ? '继承公开' : '继承保密'}</div>
                      <div className="text-xs text-slate-400">
                        {lightspeedBroadcastInherit
                          ? '未来玩家继承此遗留物时，继承事件将写入公共游戏日志'
                          : '未来玩家继承此遗留物时，仅继承者本人可见，不写入公共游戏日志'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLightspeedBroadcastInherit(!lightspeedBroadcastInherit)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${lightspeedBroadcastInherit ? 'bg-emerald-600' : 'bg-amber-600'}`}
                    role="switch"
                    aria-checked={lightspeedBroadcastInherit}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${lightspeedBroadcastInherit ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            )}

            {/* 费用总览 */}
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50 space-y-1 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>跃迁费（{lightspeedMode === 'random' ? '随机' : '指定'}）</span>
                <span className="text-yellow-400">{lightspeedJumpCost}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>留言费</span>
                <span className="text-yellow-400">{lightspeedMessageCost}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>携带能量</span>
                <span className="text-yellow-400">{lightspeedCarry}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-700/50 font-bold">
                <span className="text-slate-200">合计消耗 / 当前能量</span>
                <span className={humanPlayer.energy >= lightspeedTotalCost + lightspeedCarry ? 'text-emerald-400' : 'text-red-400'}>
                  {lightspeedTotalCost + lightspeedCarry} / {humanPlayer.energy}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setLightspeedDialogOpen(false)}>取消</Button>
            <Button
              variant="default"
              onClick={confirmLightspeedShip}
              className="bg-purple-600 hover:bg-purple-700"
              disabled={humanPlayer.energy < lightspeedTotalCost + lightspeedCarry || (lightspeedMode === 'specified' && lightspeedTarget < 1)}
            >
              确认跃迁
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Classic 模式光速飞船：手牌直接跃迁（无留言、无携带能量） */}
      <Dialog open={classicLightspeedDialogOpen} onOpenChange={(open) => { if (!open) closeClassicLightspeedDialog(); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Rocket className="w-5 h-5 text-purple-400" />光速飞船 — 跃迁抉择（Classic）</DialogTitle>
            <DialogDescription className="text-slate-400">
              Classic 模式：从手牌直接发动跃迁（一次性消耗）。随机（{modeRules.lightspeedCombinedActionCost} 能量，位置不公开）或指定（{modeRules.lightspeedCombinedActionCostSpecified} 能量，位置公开）。此模式不支持留言与携带能量，余下能量与设施选择遗留或销毁。
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 max-md:space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            {/* 当前卡牌信息 */}
            {currentCard && (
              <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
                <div className="flex-1">
                  <div className="font-bold text-white">{currentCard.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{currentCard.description}</div>
                </div>
                <Badge className="bg-purple-500/20 text-purple-300 border-0">手牌</Badge>
              </div>
            )}

            {/* 步骤 a：跃迁模式选择 */}
            <div className="space-y-2">
              <Label className="text-slate-300"><Rocket className="w-4 h-4 text-purple-400" /> 跃迁模式</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleClassicLightspeedModeChange('random')}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${classicLightspeedMode === 'random' ? 'bg-purple-900/40 border-purple-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-purple-200">随机跃迁</span>
                  <span className="text-xs text-slate-400">{modeRules.lightspeedCombinedActionCost} 能量 · 位置不公开</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleClassicLightspeedModeChange('specified')}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${classicLightspeedMode === 'specified' ? 'bg-amber-900/40 border-amber-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-amber-200">指定跃迁</span>
                  <span className="text-xs text-slate-400">{modeRules.lightspeedCombinedActionCostSpecified} 能量 · 位置公开</span>
                </button>
              </div>
            </div>

            {/* 步骤 b：指定模式下的目标星球选择 */}
            {classicLightspeedMode === 'specified' && (
              <div className="space-y-2">
                <Label className="text-slate-300"><MapPin className="w-4 h-4 text-amber-400" /> 目标星系</Label>
                <Select
                  value={classicLightspeedTarget >= 1 ? String(classicLightspeedTarget) : ''}
                  onValueChange={(v) => setClassicLightspeedTarget(Number(v))}
                >
                  <SelectTrigger className="w-full bg-slate-800/50 border-slate-700 text-white">
                    <SelectValue placeholder="选择目标星球（1-9，非当前）" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {classicLightspeedValidTargets.map(s => (
                      <SelectItem key={s} value={String(s)}>星系 {s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {classicLightspeedValidTargets.length === 0 && (
                  <p className="text-xs text-red-400">没有可选目标星系</p>
                )}
              </div>
            )}

            {/* 步骤 c：遗留/销毁二选一 */}
            <div className="space-y-2">
              <Label className="text-slate-300"><AlertTriangle className="w-4 h-4 text-orange-400" /> 余下能量与设施</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setClassicLightspeedLeaveBehind(true)}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${classicLightspeedLeaveBehind ? 'bg-purple-900/40 border-purple-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-purple-200">遗留</span>
                  <span className="text-xs text-slate-400">余下能量与设施留原星球，供继承</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClassicLightspeedLeaveBehind(false)}
                  className={`flex flex-col gap-1 p-3 rounded-lg border transition-colors text-left ${!classicLightspeedLeaveBehind ? 'bg-red-900/40 border-red-600' : 'bg-slate-800/40 border-slate-700 hover:bg-slate-700/40'}`}
                >
                  <span className="font-bold text-red-200">销毁</span>
                  <span className="text-xs text-slate-400">设施进弃牌堆，能量流失</span>
                </button>
              </div>
            </div>

            {/* 步骤 d：继承事件公开开关（仅在「遗留」时显示） */}
            {classicLightspeedLeaveBehind && (
              <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {classicLightspeedBroadcastInherit ? <Eye className="w-4 h-4 text-emerald-400" /> : <EyeOff className="w-4 h-4 text-amber-400" />}
                    <div>
                      <div className="text-sm font-medium text-slate-200">{classicLightspeedBroadcastInherit ? '继承公开' : '继承保密'}</div>
                      <div className="text-xs text-slate-400">
                        {classicLightspeedBroadcastInherit
                          ? '未来玩家继承此遗留物时，继承事件将写入公共游戏日志'
                          : '未来玩家继承此遗留物时，仅继承者本人可见，不写入公共游戏日志'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setClassicLightspeedBroadcastInherit(!classicLightspeedBroadcastInherit)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${classicLightspeedBroadcastInherit ? 'bg-emerald-600' : 'bg-amber-600'}`}
                    role="switch"
                    aria-checked={classicLightspeedBroadcastInherit}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${classicLightspeedBroadcastInherit ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            )}

            {/* 费用总览 */}
            <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/50 space-y-1 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>跃迁费（{classicLightspeedMode === 'random' ? '随机' : '指定'}）</span>
                <span className="text-yellow-400">{classicLightspeedCost}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-700/50 font-bold">
                <span className="text-slate-200">合计消耗 / 当前能量</span>
                <span className={humanPlayer.energy >= classicLightspeedCost ? 'text-emerald-400' : 'text-red-400'}>
                  {classicLightspeedCost} / {humanPlayer.energy}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeClassicLightspeedDialog}>取消</Button>
            <Button
              variant="default"
              onClick={confirmClassicLightspeedShip}
              className="bg-purple-600 hover:bg-purple-700"
              disabled={humanPlayer.energy < classicLightspeedCost || (classicLightspeedMode === 'specified' && classicLightspeedTarget < 1)}
            >
              确认跃迁
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 简略模式下点击"回收"按钮唤起的回收弹窗：显示原始卡牌（图文），逐张点击回收 */}
      <Dialog open={recycleDialogOpen} onOpenChange={setRecycleDialogOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-md:max-w-[90vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Recycle className="w-5 h-5 text-emerald-400" />回收门牌</DialogTitle>
            <DialogDescription className="text-slate-400">点击下方门牌进行回收，可获得 50% 能量返还</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 max-h-[60vh] overflow-y-auto py-2">
            {humanPlayer.faceUpCards.length === 0 ? (
              <div className="text-sm text-slate-500 py-4 text-center w-full">暂无门牌可回收</div>
            ) : (
              humanPlayer.faceUpCards.map((card: Card) => (
                <GameCard
                  key={card.uid}
                  card={card}
                  onClick={() => handleRecycleFromDialog(card)}
                  disabled={!canAct}
                />
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRecycleDialogOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

OnlinePlayerHand.displayName = 'OnlinePlayerHand';
