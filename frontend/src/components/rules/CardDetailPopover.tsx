import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import type { CardDef, CardType } from '@/lib/game/types';
import { CARD_IMAGE_MAP } from '@/lib/game/cards';

const CARD_TYPE_LABELS: Record<CardType, string> = {
  broadcast: '广播',
  strike: '打击',
  defense: '防御',
  facility: '设施',
};

const CARD_TYPE_BADGE_CLASS: Record<CardType, string> = {
  broadcast: 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10',
  strike: 'border-red-500/50 text-red-300 bg-red-500/10',
  defense: 'border-blue-500/50 text-blue-300 bg-blue-500/10',
  facility: 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10',
};

/**
 * 把 extended 字段中的原始 key 翻译为玩家向标签。
 * 不同卡牌类型关注不同字段。
 */
function renderExtendedFields(card: CardDef): Array<{ label: string; value: string }> {
  const ext = card.extended;
  const fields: Array<{ label: string; value: string }> = [];

  switch (card.type) {
    case 'broadcast':
      if (typeof ext.subtype === 'string') {
        fields.push({ label: '子类型', value: ext.subtype === 'cooperation' ? '合作' : '伪装' });
      }
      if (typeof ext.range === 'number') {
        fields.push({ label: '广播范围', value: ext.range >= 1000 ? '无视距离' : `${ext.range} 跳` });
      }
      break;
    case 'strike':
      if (typeof ext.level === 'number') fields.push({ label: '打击等级', value: `Lv.${ext.level}` });
      if (typeof ext.speed === 'number') fields.push({ label: '飞行速度', value: `${ext.speed} 跳/回合` });
      if (typeof ext.effect === 'string') fields.push({ label: '特殊效果', value: '毁灭目标星系恒星 / 建筑 / 全清除（见描述）' });
      break;
    case 'defense':
      if (typeof ext.protection_level === 'number') {
        fields.push({ label: '防护等级', value: `Lv.${ext.protection_level}` });
      }
      if (ext.duration === 'permanent') fields.push({ label: '持续时间', value: '永久' });
      break;
    case 'facility':
      if (typeof ext.energy_per_turn === 'number') {
        fields.push({ label: '能量产出', value: `${ext.energy_per_turn} 点/回合` });
      }
      if (typeof ext.ability === 'string') {
        const abilityLabel: Record<string, string> = {
          detect_broadcast: '检测广播（可不回应）',
          escape: '跃迁逃生',
        };
        fields.push({ label: '特殊能力', value: abilityLabel[ext.ability] ?? ext.ability });
      }
      if (ext.duration === 'permanent') fields.push({ label: '持续时间', value: '永久' });
      break;
  }

  return fields;
}

export interface CardDetailPopoverProps {
  card: CardDef;
  /** 触发器内容（通常是卡牌缩略图） */
  children: ReactNode;
}

/**
 * 卡牌详情浮窗 — 点击卡牌缩略图后弹出。
 * 显示卡牌的完整信息：名称、类型、能量、数量、描述、特殊属性。
 */
export function CardDetailPopover({ card, children }: CardDetailPopoverProps) {
  const extendedFields = renderExtendedFields(card);

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-0 bg-slate-900 border-slate-700 text-slate-100"
      >
        <div className="flex items-stretch gap-3 p-3 border-b border-slate-800">
          <div className="flex-shrink-0 w-16 h-16 rounded-md bg-slate-950/80 overflow-hidden">
            <img src={CARD_IMAGE_MAP[card.id] ?? card.image} alt={card.name} className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold text-sm truncate">{card.name}</h4>
              <Badge variant="outline" className={`text-[10px] ${CARD_TYPE_BADGE_CLASS[card.type]}`}>
                {CARD_TYPE_LABELS[card.type]}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
              <span>能量 <span className="text-amber-300 font-medium">{card.energy}</span></span>
              <span>数量 <span className="text-cyan-300 font-medium">×{card.quantity}</span></span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{card.id}</div>
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">卡牌描述</div>
            <p className="text-xs leading-relaxed text-slate-300">{card.description}</p>
          </div>

          {extendedFields.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">属性</div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {extendedFields.map((f) => (
                  <div key={f.label} className="text-xs">
                    <dt className="text-slate-500">{f.label}</dt>
                    <dd className="text-slate-200 font-medium">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
