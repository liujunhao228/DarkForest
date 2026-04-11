'use client';

import { memo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/lib/game/types';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Orbit, Radio, Zap, Shield, Factory } from 'lucide-react';

// 常量定义在组件外部避免每次渲染重新创建
const TYPE_COLORS: Record<string, string> = {
  broadcast: 'border-emerald-500/50 bg-emerald-950/30',
  strike: 'border-red-500/50 bg-red-950/30',
  defense: 'border-blue-500/50 bg-blue-950/30',
  facility: 'border-amber-500/50 bg-amber-950/30',
};

const TYPE_LABEL_COLORS: Record<string, string> = {
  broadcast: 'bg-emerald-500/20 text-emerald-300',
  strike: 'bg-red-500/20 text-red-300',
  defense: 'bg-blue-500/20 text-blue-300',
  facility: 'bg-amber-500/20 text-amber-300',
};

const TYPE_LABELS: Record<string, string> = {
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

function GameCardComponent({
  card,
  onClick,
  selected = false,
  disabled = false,
  faceDown = false,
  compact = false,
  inHand = false,
  showSubtype = true,
}: GameCardProps) {
  const [imageError, setImageError] = useState(false);

  // 能量不足时添加灰色遮罩效果
  const isEnergyInsufficient = disabled && inHand;

  if (faceDown) {
    return (
      <motion.div
        className={`relative flex-shrink-0 rounded-lg border border-slate-600 bg-slate-800 overflow-hidden
          ${compact ? 'w-16 h-22' : 'w-24 h-32'}
          ${inHand ? 'cursor-pointer' : ''}`}
        whileHover={inHand ? { scale: 1.05, y: -8 } : {}}
        whileTap={inHand ? { scale: 0.95 } : {}}
        onClick={onClick}
      >
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
          <div className="text-center">
            <Orbit className="w-8 h-8 mx-auto text-slate-500" />
            <div className="text-[8px] text-slate-500 mt-1">暗森</div>
          </div>
        </div>
      </motion.div>
    );
  }

  const typeClass = TYPE_COLORS[card.type] || 'border-slate-500 bg-slate-800/50';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
          <motion.div
            className={`relative flex-shrink-0 rounded-lg border-2 overflow-hidden shadow-lg
              ${compact ? 'w-16 h-22' : 'w-24 h-32'}
              ${typeClass}
              ${selected ? 'ring-2 ring-white shadow-white/20' : ''}
              ${disabled ? 'opacity-40 cursor-not-allowed grayscale-[0.5]' : inHand ? 'cursor-pointer' : ''}
              ${isEnergyInsufficient ? 'after:absolute after:inset-0 after:bg-black/60 after:pointer-events-none' : ''}
              transition-all`}
            whileHover={!disabled && inHand ? { scale: 1.08, y: -12 } : {}}
            whileTap={!disabled && inHand ? { scale: 0.95 } : {}}
            onClick={!disabled ? onClick : undefined}
            layout
          >
            {/* 能量不足提示 */}
            {isEnergyInsufficient && (
              <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                <span className="text-xs font-bold text-red-400 bg-black/80 px-2 py-1 rounded">
                  能量不足
                </span>
              </div>
            )}
            {/* Card image */}
            <div className={`relative ${compact ? 'h-14' : 'h-20'} overflow-hidden bg-black/30`}>
              {!imageError && card.image ? (
                <img
                  src={card.image}
                  alt={card.name}
                  className="w-full h-full object-contain p-1"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {card.type === 'broadcast' ? <Radio className="w-8 h-8 opacity-60" /> :
                   card.type === 'strike' ? <Zap className="w-8 h-8 opacity-60" /> :
                   card.type === 'defense' ? <Shield className="w-8 h-8 opacity-60" /> :
                   <Factory className="w-8 h-8 opacity-60" />}
                </div>
              )}

              {/* Energy cost badge */}
              {card.energy > 0 && (
                <div className="absolute top-0.5 right-0.5 bg-black/70 rounded-full w-5 h-5 flex items-center justify-center">
                  <Zap className="w-2.5 h-2.5 text-yellow-400" />
                  <span className="text-[9px] text-yellow-400 font-bold">{card.energy}</span>
                </div>
              )}
            </div>

            {/* Card info */}
            <div className={`p-1 ${compact ? 'h-8' : 'h-12'} flex flex-col justify-between`}>
              <div className="font-bold text-[9px] text-white truncate leading-tight">
                {card.name}
              </div>

              <div className="flex items-center gap-1">
                <Badge className={`${TYPE_LABEL_COLORS[card.type]} text-[7px] px-1 py-0 border-0`}>
                  {TYPE_LABELS[card.type]}
                </Badge>
                {showSubtype && card.subtype && (
                  <Badge className={`${card.subtype === 'cooperation' ? 'bg-green-500/20 text-green-300' : 'bg-orange-500/20 text-orange-300'} text-[7px] px-1 py-0 border-0`}>
                    {card.subtype === 'cooperation' ? '合作' : '伪装'}
                  </Badge>
                )}
              </div>

              {/* Extra info */}
              {card.level && (
                <div className="text-[7px] text-red-400">Lv.{card.level}</div>
              )}
              {card.protectionLevel && (
                <div className="text-[7px] text-blue-400">防御 Lv.{card.protectionLevel}</div>
              )}
              {card.energyPerTurn && (
                <div className="text-[7px] text-amber-400 flex items-center gap-0.5">+{card.energyPerTurn}<Zap className="w-2 h-2" />/回合</div>
              )}
              {card.range && card.range < 100 && (
                <div className="text-[7px] text-emerald-400">范围 {card.range}</div>
              )}
              {card.range && card.range >= 100 && (
                <div className="text-[7px] text-emerald-400">无限范围</div>
              )}
            </div>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          <div className="text-sm font-bold">{card.name}</div>
          <div className="text-xs text-muted-foreground mt-1">{card.description}</div>
          {card.energy > 0 && (
            <div className="text-xs text-yellow-500 mt-1 flex items-center gap-1">消耗: <Zap className="w-3 h-3" />{card.energy}</div>
          )}
        </TooltipContent>
      </Tooltip>
  );
}

export const GameCard = memo(GameCardComponent);
