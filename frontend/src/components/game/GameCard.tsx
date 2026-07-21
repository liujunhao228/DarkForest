import { memo, useState } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Zap } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useLongPress } from '@/hooks/use-long-press';

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

interface GameCardProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  faceDown?: boolean;
  compact?: boolean;
  inHand?: boolean;
  showSubtype?: boolean;
}

function GameCardComponent({ card, onClick, selected = false, disabled = false, faceDown = false, compact = false, inHand = false, showSubtype = true }: GameCardProps) {
  const [imageError, setImageError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isMobile = useIsMobile();

  // 触屏长按预览：长按弹 Popover 显示卡牌详情，短按触发 onClick
  // 若预览已打开则短按仅关闭预览，不触发 onClick（避免误用牌）
  const longPress = useLongPress({
    onLongPress: () => setPreviewOpen(true),
    onPress: () => {
      if (previewOpen) {
        setPreviewOpen(false);
        return;
      }
      if (!disabled) onClick?.();
    },
    delay: 500,
  });

  const isEnergyInsufficient = disabled && inHand;

  if (faceDown) {
    return (
      <motion.div
        className={`relative flex-shrink-0 rounded-lg border border-slate-600/80 bg-slate-800 overflow-hidden ${compact ? 'w-16 h-22' : 'w-24 h-32'} ${inHand ? 'cursor-pointer' : ''}`}
        whileHover={inHand ? { scale: 1.05, y: -8 } : {}}
        whileTap={inHand ? { scale: 0.95 } : {}}
        onClick={onClick}
      >
        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-black">
          {/* 内描边青色微光，呼应能量晶体 */}
          <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-cyan-500/10 pointer-events-none" />
          <div className="text-center">
            <img src={energySvg} alt="" aria-hidden className={`${compact ? 'w-7 h-7' : 'w-10 h-10'} mx-auto opacity-30`} />
            <div className="text-[8px] text-cyan-500/60 tracking-widest mt-1">暗森</div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <motion.div
              className={`relative flex-shrink-0 rounded-lg border-2 overflow-hidden shadow-xl bg-gradient-to-br ${TYPE_GRADIENTS[card.type]} ${TYPE_BORDERS[card.type]} ${TYPE_GLOWS[card.type]} ${compact ? 'w-16 h-22' : 'w-24 h-32'} ${selected ? 'ring-2 ring-white shadow-white/20' : ''} ${disabled ? 'opacity-40 cursor-not-allowed grayscale-[0.5]' : inHand ? 'cursor-pointer' : ''} ${isEnergyInsufficient ? 'after:absolute after:inset-0 after:bg-black/60 after:pointer-events-none' : ''} transition-all`}
              whileHover={!disabled && inHand ? { scale: 1.08, y: -12 } : {}}
              whileTap={!disabled && inHand ? { scale: 0.95 } : {}}
              onClick={!disabled && !isMobile ? onClick : undefined}
              {...(isMobile ? longPress : {})}
              layout
            >
          {/* 内描边高光，模拟卡牌质感边缘 */}
          <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10 pointer-events-none z-[5]" />
          {isEnergyInsufficient && (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <span className="text-xs font-bold text-red-400 bg-black/80 px-2 py-1 rounded">能量不足</span>
            </div>
          )}
          <div className={`relative ${compact ? 'h-14' : 'h-20'} overflow-hidden bg-gradient-to-b from-black/40 to-black/20`}>
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
              <div className="absolute top-0.5 right-0.5 bg-gradient-to-br from-slate-900 to-black border border-cyan-400/30 rounded-full w-5 h-5 flex items-center justify-center gap-0.5">
                <img src={energySvg} alt="能量" className="w-2.5 h-2.5" />
                <span className="text-[9px] text-cyan-300 font-bold">{card.energy}</span>
              </div>
            )}
          </div>
          <div className={`relative p-1 ${compact ? 'h-8' : 'h-12'} flex flex-col justify-between`}>
            <div className="font-bold text-[9px] text-white truncate leading-tight">{card.name}</div>
            <div className="flex items-center gap-1">
              <Badge className={`${TYPE_LABEL_COLORS[card.type]} text-[7px] px-1 py-0 border-0 inline-flex items-center gap-0.5`}>
                <img src={TYPE_ICON_PATH[card.type]} alt="" aria-hidden className="w-2 h-2 inline-block" />
                {TYPE_LABELS[card.type]}
              </Badge>
              {showSubtype && card.subtype && (
                <Badge className={`${card.subtype === 'cooperation' ? 'bg-green-500/20 text-green-300' : 'bg-orange-500/20 text-orange-300'} text-[7px] px-1 py-0 border-0 inline-flex items-center gap-0.5`}>
                  <img src={SUBTYPE_ICON[card.subtype]} alt="" aria-hidden className="w-2 h-2 inline-block" />
                  {card.subtype === 'cooperation' ? '合作' : '伪装'}
                </Badge>
              )}
            </div>
            {card.level && <div className="text-[7px] text-red-400">Lv.{card.level}</div>}
            {card.protectionLevel && <div className="text-[7px] text-blue-400">防御 Lv.{card.protectionLevel}</div>}
            {card.energyPerTurn && <div className="text-[7px] text-amber-400 flex items-center gap-0.5">+{card.energyPerTurn}<img src={energySvg} alt="能量" className="w-2 h-2 inline-block" />/回合</div>}
            {card.range && card.range < 100 && <div className="text-[7px] text-emerald-400">范围 {card.range}</div>}
            {card.range && card.range >= 100 && <div className="text-[7px] text-emerald-400">无限范围</div>}
          </div>
        </motion.div>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          <div className="text-sm font-bold">{card.name}</div>
          <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
          {card.energy > 0 && <div className="text-xs text-yellow-500 mt-1 flex items-center gap-1">消耗: <Zap className="w-3 h-3" />{card.energy}</div>}
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="top" className="max-w-[240px]">
          <div className="text-sm font-bold">{card.name}</div>
          <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
          {card.energy > 0 && <div className="text-xs text-yellow-500 mt-1 flex items-center gap-1">消耗: <Zap className="w-3 h-3" />{card.energy}</div>}
        </PopoverContent>
    </Popover>
  );
}

export const GameCard = memo(GameCardComponent);

interface StackedGameCardProps {
  card: Card;
  count: number;
  compact?: boolean;
  inHand?: boolean;
  showSubtype?: boolean;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
}

function StackedGameCardComponent({ card, count, compact = false, inHand = false, showSubtype = true, onClick, selected = false, disabled = false }: StackedGameCardProps) {
  // count <= 1 时直接渲染普通 GameCard，零侵入
  if (count <= 1) {
    return <GameCard card={card} compact={compact} inHand={inHand} showSubtype={showSubtype} onClick={onClick} selected={selected} disabled={disabled} />;
  }

  // count > 1 时堆叠渲染：背后偏移 1 张相同卡牌作为厚度提示 + 右上角 ×N 徽章
  return (
    <div className="relative">
      {/* 厚度层：偏移 3px 的相同卡牌轮廓，仅作视觉提示 */}
      <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-lg border-2 border-slate-600/80 bg-gradient-to-br from-slate-800/80 to-slate-950/80 shadow-lg" aria-hidden />
      {/* 主卡牌 */}
      <div className="relative">
        <GameCard card={card} compact={compact} inHand={inHand} showSubtype={showSubtype} onClick={onClick} selected={selected} disabled={disabled} />
        {/* 数量徽章 */}
        <Badge className="absolute -top-1.5 -right-1.5 z-20 bg-slate-900 text-white border border-slate-600 text-[9px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full shadow-lg">
          ×{count}
        </Badge>
      </div>
    </div>
  );
}

export const StackedGameCard = memo(StackedGameCardComponent);
