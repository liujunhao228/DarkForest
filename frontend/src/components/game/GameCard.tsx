import { memo, useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { Card, CardType, BroadcastSubtype } from '@/lib/game/types';
import { CARD_IMAGE_MAP } from '@/lib/game/cards';
import broadcastIconSvg from '@/assets/images/icons/broadcast.svg';
import strikeIconSvg from '@/assets/images/icons/strike.svg';
import defenseIconSvg from '@/assets/images/icons/defense.svg';
import facilityIconSvg from '@/assets/images/icons/facility.svg';
import cooperationSvg from '@/assets/images/broadcast/cooperation.svg';
import disguiseSvg from '@/assets/images/broadcast/disguise.svg';
import energySvg from '@/assets/images/energy.svg';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { Zap } from 'lucide-react';
import { useIsMobile, useBreakpoint } from '@/hooks/use-mobile';
import { useLongPress } from '@/hooks/use-long-press';
import { getCardSizeForBreakpoint, type CardSize } from '@/hooks/useGameLayout';

// 类型图标路径（用于水印、图片兜底、类型徽章）
const TYPE_ICON_PATH: Record<CardType, string> = {
  broadcast: broadcastIconSvg,
  strike: strikeIconSvg,
  defense: defenseIconSvg,
  facility: facilityIconSvg,
};

// 类型主题渐变背景（替换原纯色背景）
const TYPE_GRADIENTS: Record<CardType, string> = {
  broadcast: 'from-emerald-950/80 via-emerald-900/40 to-slate-950/80',
  strike: 'from-red-950/80 via-red-900/40 to-slate-950/80',
  defense: 'from-blue-950/80 via-blue-900/40 to-slate-950/80',
  facility: 'from-amber-950/80 via-amber-900/40 to-slate-950/80',
};

// 类型边框色
const TYPE_BORDERS: Record<CardType, string> = {
  broadcast: 'border-emerald-500/60',
  strike: 'border-red-500/60',
  defense: 'border-blue-500/60',
  facility: 'border-amber-500/60',
};

// 类型光晕阴影色
const TYPE_GLOWS: Record<CardType, string> = {
  broadcast: 'shadow-emerald-500/20',
  strike: 'shadow-red-500/20',
  defense: 'shadow-blue-500/20',
  facility: 'shadow-amber-500/20',
};

// 广播子类型图标路径
const SUBTYPE_ICON: Record<BroadcastSubtype, string> = {
  cooperation: cooperationSvg,
  disguise: disguiseSvg,
};

const TYPE_LABEL_COLORS: Record<CardType, string> = {
  broadcast: 'bg-emerald-500/20 text-emerald-300',
  strike: 'bg-red-500/20 text-red-300',
  defense: 'bg-blue-500/20 text-blue-300',
  facility: 'bg-amber-500/20 text-amber-300',
};

const TYPE_LABELS: Record<CardType, string> = {
  broadcast: '广播',
  strike: '打击',
  defense: '防御',
  facility: '设施',
};

/**
 * 卡牌尺寸档位样式映射表。
 * - xs: 48×68（小屏手牌区，iPhone SE）
 * - sm: 56×80（主流手机）
 * - md: 64×88（平板/原 compact）
 * - lg: 96×128（桌面/原默认）
 */
const CARD_SIZE_STYLES: Record<CardSize, {
  container: string;
  image: string;
  info: string;
  energyBadge: string;
  energyIcon: string;
  energyText: string;
  titleText: string;
  badgeText: string;
  badgeIcon: string;
  levelText: string;
  faceDownIcon: string;
  faceDownText: string;
}> = {
  xs: {
    container: 'w-12 h-[68px]',
    image: 'h-10',
    info: 'h-7',
    energyBadge: 'w-4 h-4',
    energyIcon: 'w-2 h-2',
    energyText: 'text-[7px]',
    titleText: 'text-[7px]',
    badgeText: 'text-[6px] px-0.5',
    badgeIcon: 'w-1.5 h-1.5',
    levelText: 'text-[6px]',
    faceDownIcon: 'w-5 h-5',
    faceDownText: 'text-[7px]',
  },
  sm: {
    container: 'w-14 h-20',
    image: 'h-12',
    info: 'h-8',
    energyBadge: 'w-4 h-4',
    energyIcon: 'w-2 h-2',
    energyText: 'text-[8px]',
    titleText: 'text-[8px]',
    badgeText: 'text-[6px] px-0.5',
    badgeIcon: 'w-1.5 h-1.5',
    levelText: 'text-[6px]',
    faceDownIcon: 'w-6 h-6',
    faceDownText: 'text-[7px]',
  },
  md: {
    container: 'w-16 h-[88px]',
    image: 'h-14',
    info: 'h-8',
    energyBadge: 'w-5 h-5',
    energyIcon: 'w-2.5 h-2.5',
    energyText: 'text-[9px]',
    titleText: 'text-[9px]',
    badgeText: 'text-[7px] px-1',
    badgeIcon: 'w-2 h-2',
    levelText: 'text-[7px]',
    faceDownIcon: 'w-7 h-7',
    faceDownText: 'text-[8px]',
  },
  lg: {
    container: 'w-24 h-32',
    image: 'h-20',
    info: 'h-12',
    energyBadge: 'w-5 h-5',
    energyIcon: 'w-2.5 h-2.5',
    energyText: 'text-[9px]',
    titleText: 'text-[9px]',
    badgeText: 'text-[7px] px-1',
    badgeIcon: 'w-2 h-2',
    levelText: 'text-[7px]',
    faceDownIcon: 'w-10 h-10',
    faceDownText: 'text-[8px]',
  },
};

interface GameCardProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  faceDown?: boolean;
  /**
   * 卡牌尺寸档位。优先级：size > compact > 自动按断点。
   * 未显式传入时，根据 useBreakpoint 自动选择（xs/sm/md/lg）。
   */
  size?: CardSize;
  /** @deprecated 使用 size="md" 代替。保留向后兼容。 */
  compact?: boolean;
  inHand?: boolean;
  showSubtype?: boolean;
}

function GameCardComponent({ card, onClick, selected = false, disabled = false, faceDown = false, size, compact = false, inHand = false, showSubtype = true }: GameCardProps) {
  const [imageError, setImageError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isMobile = useIsMobile();
  const breakpoint = useBreakpoint();

  // 尺寸优先级：显式 size > compact 兼容 > 断点自动
  const resolvedSize: CardSize = size ?? (compact ? 'md' : getCardSizeForBreakpoint(breakpoint));
  const sizeStyle = CARD_SIZE_STYLES[resolvedSize];

  // 记录最近一次触屏 onPress 触发时间，用于 onClick 去重
  // 避免触屏点击同时触发 onPress 与原生 click，导致双触发
  const lastTouchPressRef = useRef(0);

  // 触屏长按预览：长按弹 Popover 显示卡牌详情，短按触发 onClick
  // 若预览已打开则短按仅关闭预览，不触发 onClick（避免误用牌）
  const longPress = useLongPress({
    onLongPress: () => setPreviewOpen(true),
    onPress: () => {
      lastTouchPressRef.current = Date.now();
      if (previewOpen) {
        setPreviewOpen(false);
        return;
      }
      if (!disabled) onClick?.();
    },
    delay: 500,
  });

  // 移动端 onClick 兜底：仅当非触屏（pointerType === 'mouse' 等）时触发
  // 触屏场景由 useLongPress.onPress 处理，通过时间戳去重避免双触发
  const handleClick = useCallback(() => {
    // 若刚刚被 onPress 触发过（300ms 内），认为是同一次触屏手势的合成 click，忽略
    if (Date.now() - lastTouchPressRef.current < 300) return;
    if (!disabled) onClick?.();
  }, [disabled, onClick]);

  const isEnergyInsufficient = disabled && inHand;

  if (faceDown) {
    return (
      <motion.div
        className={`relative flex-shrink-0 rounded-lg border border-slate-600/80 bg-slate-800 overflow-hidden ${sizeStyle.container} ${inHand ? 'cursor-pointer' : ''}`}
        whileHover={inHand ? { scale: 1.05, y: -8 } : {}}
        whileTap={inHand ? { scale: 0.95 } : {}}
        onClick={onClick}
      >
        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-black">
          {/* 内描边青色微光，呼应能量晶体 */}
          <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-cyan-500/10 pointer-events-none" />
          <div className="text-center">
            <img src={energySvg} alt="" aria-hidden className={`${sizeStyle.faceDownIcon} mx-auto opacity-30`} />
            <div className={`${sizeStyle.faceDownText} text-cyan-500/60 tracking-widest mt-1`}>暗森</div>
          </div>
        </div>
      </motion.div>
    );
  }

  const cardClassName = `relative flex-shrink-0 rounded-lg border-2 overflow-hidden shadow-xl bg-gradient-to-br ${TYPE_GRADIENTS[card.type]} ${TYPE_BORDERS[card.type]} ${TYPE_GLOWS[card.type]} ${sizeStyle.container} ${selected ? 'ring-2 ring-white shadow-white/20' : ''} ${disabled ? 'opacity-40 cursor-not-allowed grayscale-[0.5]' : inHand ? 'cursor-pointer' : ''} ${isEnergyInsufficient ? 'after:absolute after:inset-0 after:bg-black/60 after:pointer-events-none' : ''} transition-all ${isMobile ? 'touch-manipulation' : ''}`;

  const motionProps = {
    className: cardClassName,
    whileHover: !disabled && inHand ? { scale: 1.08, y: -12 } : {},
    whileTap: !disabled && inHand ? { scale: 0.95 } : {},
    layout: true as const,
  };

  const cardInner = (
    <>
      {/* 内描边高光，模拟卡牌质感边缘 */}
      <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10 pointer-events-none z-[5]" />
      {isEnergyInsufficient && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="text-xs font-bold text-red-400 bg-black/80 px-2 py-1 rounded">能量不足</span>
        </div>
      )}
      <div className={`relative ${sizeStyle.image} overflow-hidden bg-gradient-to-b from-black/40 to-black/20`}>
        {(() => {
          const imageUrl = CARD_IMAGE_MAP[card.defId];
          if (imageError || !imageUrl) {
            return (
              <img
                src={TYPE_ICON_PATH[card.type]}
                alt=""
                aria-hidden
                className="absolute inset-0 w-full h-full object-contain p-1 pointer-events-none opacity-50"
              />
            );
          }
          return (
            <img
              src={imageUrl}
              alt={card.name}
              className="relative w-full h-full object-contain p-1 [filter:drop-shadow(0_1px_4px_rgba(0,0,0,0.5))]"
              onError={() => setImageError(true)}
            />
          );
        })()}
        {card.energy > 0 && (
          <div className={`absolute top-0.5 right-0.5 bg-gradient-to-br from-slate-900 to-black border border-cyan-400/30 rounded-full ${sizeStyle.energyBadge} flex items-center justify-center gap-0.5`}>
            <img src={energySvg} alt="能量" className={sizeStyle.energyIcon} />
            <span className={`${sizeStyle.energyText} text-cyan-300 font-bold`}>{card.energy}</span>
          </div>
        )}
      </div>
      <div className={`relative p-1 ${sizeStyle.info} flex flex-col justify-between`}>
        <div className={`font-bold ${sizeStyle.titleText} text-white truncate leading-tight`}>{card.name}</div>
        <div className="flex items-center gap-1">
          <Badge className={`${TYPE_LABEL_COLORS[card.type]} ${sizeStyle.badgeText} py-0 border-0 inline-flex items-center gap-0.5`}>
            <img src={TYPE_ICON_PATH[card.type]} alt="" aria-hidden className={`${sizeStyle.badgeIcon} inline-block`} />
            {TYPE_LABELS[card.type]}
          </Badge>
          {showSubtype && card.subtype && (
            <Badge className={`${card.subtype === 'cooperation' ? 'bg-green-500/20 text-green-300' : 'bg-orange-500/20 text-orange-300'} ${sizeStyle.badgeText} py-0 border-0 inline-flex items-center gap-0.5`}>
              <img src={SUBTYPE_ICON[card.subtype]} alt="" aria-hidden className={`${sizeStyle.badgeIcon} inline-block`} />
              {card.subtype === 'cooperation' ? '合作' : '伪装'}
            </Badge>
          )}
        </div>
        {card.level && <div className={`${sizeStyle.levelText} text-red-400`}>Lv.{card.level}</div>}
        {card.protectionLevel && <div className={`${sizeStyle.levelText} text-blue-400`}>防御 Lv.{card.protectionLevel}</div>}
        {card.energyPerTurn && <div className={`${sizeStyle.levelText} text-amber-400 flex items-center gap-0.5`}>+{card.energyPerTurn}<img src={energySvg} alt="能量" className={`${sizeStyle.badgeIcon} inline-block`} />/回合</div>}
        {card.range && card.range < 100 && <div className={`${sizeStyle.levelText} text-emerald-400`}>范围 {card.range}</div>}
        {card.range && card.range >= 100 && <div className={`${sizeStyle.levelText} text-emerald-400`}>无限范围</div>}
      </div>
    </>
  );

  const popoverContent = (
    <PopoverContent side="top" className="max-w-[240px]">
      <div className="text-sm font-bold">{card.name}</div>
      <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
      {card.energy > 0 && <div className="text-xs text-yellow-500 mt-1 flex items-center gap-1">消耗: <Zap className="w-3 h-3" />{card.energy}</div>}
    </PopoverContent>
  );

  // 移动端：Popover 受控 + Anchor，无 Tooltip，事件由 useLongPress 独占
  // 避免 Radix PopoverTrigger 在 pointerdown 时自动 setOpen(true)，
  // 导致 useLongPress.onPress 误判 previewOpen=true 而跳过 onClick
  // 同时绑定 onClick 作为鼠标输入兜底（Samsung DeX、平板蓝牙鼠标、DevTools 模拟）
  if (isMobile) {
    return (
      <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
        <PopoverAnchor asChild>
          <motion.div {...motionProps} {...longPress} onClick={handleClick}>
            {cardInner}
          </motion.div>
        </PopoverAnchor>
        {popoverContent}
      </Popover>
    );
  }

  // 桌面端：保留 Tooltip + Popover 受控 + Anchor，onClick 直接绑定
  return (
    <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverAnchor asChild>
            <motion.div {...motionProps} onClick={!disabled ? onClick : undefined}>
              {cardInner}
            </motion.div>
          </PopoverAnchor>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          <div className="text-sm font-bold">{card.name}</div>
          <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
          {card.energy > 0 && <div className="text-xs text-yellow-500 mt-1 flex items-center gap-1">消耗: <Zap className="w-3 h-3" />{card.energy}</div>}
        </TooltipContent>
      </Tooltip>
      {popoverContent}
    </Popover>
  );
}

export const GameCard = memo(GameCardComponent);

interface StackedGameCardProps {
  card: Card;
  count: number;
  size?: CardSize;
  /** @deprecated 使用 size="md" 代替。 */
  compact?: boolean;
  inHand?: boolean;
  showSubtype?: boolean;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
}

function StackedGameCardComponent({ card, count, size, compact = false, inHand = false, showSubtype = true, onClick, selected = false, disabled = false }: StackedGameCardProps) {
  // count <= 1 时直接渲染普通 GameCard，零侵入
  if (count <= 1) {
    return <GameCard card={card} size={size} compact={compact} inHand={inHand} showSubtype={showSubtype} onClick={onClick} selected={selected} disabled={disabled} />;
  }

  // count > 1 时堆叠渲染：背后偏移 1 张相同卡牌作为厚度提示 + 右上角 ×N 徽章
  return (
    <div className="relative">
      {/* 厚度层：偏移 3px 的相同卡牌轮廓，仅作视觉提示 */}
      <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-lg border-2 border-slate-600/80 bg-gradient-to-br from-slate-800/80 to-slate-950/80 shadow-lg" aria-hidden />
      {/* 主卡牌 */}
      <div className="relative">
        <GameCard card={card} size={size} compact={compact} inHand={inHand} showSubtype={showSubtype} onClick={onClick} selected={selected} disabled={disabled} />
        {/* 数量徽章 */}
        <Badge className="absolute -top-1.5 -right-1.5 z-20 bg-slate-900 text-white border border-slate-600 text-[9px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full shadow-lg">
          ×{count}
        </Badge>
      </div>
    </div>
  );
}

export const StackedGameCard = memo(StackedGameCardComponent);
