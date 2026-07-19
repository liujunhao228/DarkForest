import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { CardDef, CardType } from '@/lib/game/types';
import { CARD_IMAGE_MAP } from '@/lib/game/cards';
import { CardDetailPopover } from './CardDetailPopover';

// ============================================================================
// 卡牌类型展示元数据
// ============================================================================

const CARD_TYPE_LABELS: Record<CardType, string> = {
  broadcast: '广播',
  strike: '打击',
  defense: '防御',
  facility: '设施',
};

const CARD_TYPE_ORDER: CardType[] = ['broadcast', 'strike', 'defense', 'facility'];

const CARD_TYPE_COLORS: Record<CardType, string> = {
  broadcast: 'border-cyan-500/40 bg-cyan-500/5 text-cyan-300',
  strike: 'border-red-500/40 bg-red-500/5 text-red-300',
  defense: 'border-blue-500/40 bg-blue-500/5 text-blue-300',
  facility: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300',
};

const CARD_TYPE_DOT: Record<CardType, string> = {
  broadcast: 'bg-cyan-400',
  strike: 'bg-red-400',
  defense: 'bg-blue-400',
  facility: 'bg-emerald-400',
};

// ============================================================================
// CardDefinitionGrid
// ============================================================================

export interface CardDefinitionGridProps {
  cards: CardDef[];
  /** 分组方式，默认按类型 */
  groupBy?: 'type' | 'none';
  /** 紧凑模式：更小的卡片，适合 compact variant */
  compact?: boolean;
}

interface CardGroup {
  type: CardType;
  label: string;
  cards: CardDef[];
}

function groupCardsByType(cards: CardDef[]): CardGroup[] {
  const groups = new Map<CardType, CardDef[]>();
  for (const card of cards) {
    const list = groups.get(card.type) ?? [];
    list.push(card);
    groups.set(card.type, list);
  }
  const result: CardGroup[] = [];
  for (const type of CARD_TYPE_ORDER) {
    const list = groups.get(type);
    if (list && list.length > 0) {
      result.push({ type, label: CARD_TYPE_LABELS[type], cards: list });
    }
  }
  // 处理未知类型（理论上不会出现）
  for (const [type, list] of groups) {
    if (!CARD_TYPE_ORDER.includes(type)) {
      result.push({ type, label: type, cards: list });
    }
  }
  return result;
}

/**
 * 渲染卡牌的 extended 字段中的关键数据为短标签。
 * 不同卡牌类型关注不同的字段：
 *   - broadcast: subtype (cooperation/disguise), range
 *   - strike: level, speed, effect
 *   - defense: protection_level
 *   - facility: energy_per_turn, ability
 */
function renderCardKeyStats(card: CardDef): string[] {
  const stats: string[] = [];
  const ext = card.extended;
  switch (card.type) {
    case 'broadcast': {
      const subtype = ext.subtype === 'cooperation' ? '合作' : ext.subtype === 'disguise' ? '伪装' : '';
      if (subtype) stats.push(subtype);
      if (typeof ext.range === 'number') {
        stats.push(ext.range >= 1000 ? '无视距离' : `距离 ${ext.range}`);
      }
      break;
    }
    case 'strike': {
      if (typeof ext.level === 'number') stats.push(`Lv.${ext.level}`);
      if (typeof ext.speed === 'number') stats.push(`速 ${ext.speed}`);
      if (typeof ext.effect === 'string') stats.push('特殊效果');
      break;
    }
    case 'defense': {
      if (typeof ext.protection_level === 'number') stats.push(`防 Lv.${ext.protection_level}`);
      break;
    }
    case 'facility': {
      if (typeof ext.energy_per_turn === 'number') stats.push(`+${ext.energy_per_turn} 能量/回合`);
      if (typeof ext.ability === 'string') stats.push('特殊能力');
      break;
    }
  }
  return stats;
}

function CardTile({ card, compact }: { card: CardDef; compact?: boolean }) {
  return (
    <CardDetailPopover card={card}>
      <button
        type="button"
        className={cn(
          'group relative w-full text-left rounded-lg border bg-slate-900/40 hover:bg-slate-800/60 transition-colors overflow-hidden',
          'focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
          CARD_TYPE_COLORS[card.type],
          compact ? 'p-2' : 'p-3',
        )}
      >
        <div className="flex items-start gap-2">
          <div className={cn('flex-shrink-0 rounded-md bg-slate-950/60 overflow-hidden', compact ? 'w-10 h-10' : 'w-14 h-14')}>
            <img src={CARD_IMAGE_MAP[card.id] ?? card.image} alt={card.name} className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('inline-block w-1.5 h-1.5 rounded-full', CARD_TYPE_DOT[card.type])} />
              <h4 className={cn('font-semibold truncate text-slate-100', compact ? 'text-xs' : 'text-sm')}>{card.name}</h4>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
              <span>{card.energy} 能量</span>
              <span className="text-slate-600">·</span>
              <span>×{card.quantity}</span>
            </div>
            {!compact && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {renderCardKeyStats(card).map((stat) => (
                  <span key={stat} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-950/60 text-slate-300 border border-slate-700/60">
                    {stat}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
    </CardDetailPopover>
  );
}

export function CardDefinitionGrid({ cards, groupBy = 'type', compact }: CardDefinitionGridProps) {
  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{ type: 'broadcast' as CardType, label: '全部卡牌', cards }];
    }
    return groupCardsByType(cards);
  }, [cards, groupBy]);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.type} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className={cn('inline-block w-2 h-2 rounded-full', CARD_TYPE_DOT[group.type])} />
            <h3 className="text-sm font-semibold text-slate-200">{group.label}</h3>
            <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400">{group.cards.length} 种</Badge>
          </div>
          <div className={cn(
            'grid gap-2',
            compact ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
          )}>
            {group.cards.map((card) => (
              <CardTile key={card.id} card={card} compact={compact} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
