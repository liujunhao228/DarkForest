import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Boxes, Crown, Zap } from 'lucide-react';
import type { RelicComboExport } from '@/api/rules';

// ============================================================================
// RelicComboList — 遗迹组合图鉴
// ============================================================================

const STRENGTH_ORDER = ['弱', '中', '强'] as const;
type Strength = typeof STRENGTH_ORDER[number];

const STRENGTH_META: Record<Strength, { label: string; icon: React.ReactNode; accent: string; border: string; desc: string }> = {
  弱: {
    label: '弱',
    icon: <Sparkles className="w-3.5 h-3.5 text-cyan-300" />,
    accent: 'bg-cyan-500/10',
    border: 'border-cyan-500/40',
    desc: '低能量储备，1 个设施',
  },
  中: {
    label: '中',
    icon: <Boxes className="w-3.5 h-3.5 text-amber-300" />,
    accent: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    desc: '中等能量储备，1-2 个设施',
  },
  强: {
    label: '强',
    icon: <Crown className="w-3.5 h-3.5 text-purple-300" />,
    accent: 'bg-purple-500/10',
    border: 'border-purple-500/40',
    desc: '高能量储备，2-3 个设施',
  },
};

const STRENGTH_PROBABILITY: Record<Strength, string> = {
  弱: '60%',
  中: '30%',
  强: '10%',
};

export interface RelicComboListProps {
  relicCombos: RelicComboExport[];
  /** 紧凑模式：省略背景 lore */
  compact?: boolean;
}

interface GroupedRelics {
  strength: Strength;
  label: string;
  desc: string;
  probability: string;
  combos: RelicComboExport[];
}

function groupByStrength(combos: RelicComboExport[]): GroupedRelics[] {
  const map = new Map<Strength, RelicComboExport[]>();
  for (const combo of combos) {
    if (!STRENGTH_ORDER.includes(combo.strength as Strength)) continue;
    const strength = combo.strength as Strength;
    const list = map.get(strength) ?? [];
    list.push(combo);
    map.set(strength, list);
  }
  const result: GroupedRelics[] = [];
  for (const strength of STRENGTH_ORDER) {
    const list = map.get(strength);
    if (list && list.length > 0) {
      result.push({
        strength,
        label: STRENGTH_META[strength].label,
        desc: STRENGTH_META[strength].desc,
        probability: STRENGTH_PROBABILITY[strength],
        combos: list,
      });
    }
  }
  return result;
}

export function RelicComboList({ relicCombos, compact }: RelicComboListProps) {
  const groups = useMemo(() => groupByStrength(relicCombos), [relicCombos]);

  if (relicCombos.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-center">
        <Zap className="w-5 h-5 text-slate-600 mx-auto mb-2" />
        <p className="text-sm text-slate-500">当前模式不分布遗迹</p>
        <p className="text-xs text-slate-600 mt-1">遗迹仅在「文明遗迹模式」中分布</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
        <p className="text-xs text-slate-300 leading-relaxed">
          游戏开始时，在非玩家起始星系按概率分布预设遗迹组合（弱 60% / 中 30% / 强 10%）。
          玩家跃迁到达时可继承其中的能量与设施。
        </p>
      </div>

      {groups.map((group) => {
        const meta = STRENGTH_META[group.strength];
        return (
          <div key={group.strength} className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md', meta.accent)}>
                {meta.icon}
                <span className="text-sm font-semibold text-slate-200">{group.label}档遗迹</span>
              </span>
              <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400">
                {group.combos.length} 个组合
              </Badge>
              <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-300">
                分布概率 {group.probability}
              </Badge>
              <span className="text-xs text-slate-500">{group.desc}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {group.combos.map((combo) => (
                <div
                  key={combo.id}
                  className={cn(
                    'rounded-lg border bg-slate-900/40 p-3 space-y-2',
                    meta.border,
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-100">{combo.name}</h4>
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                        +{combo.energy} 能量
                      </Badge>
                    </div>
                  </div>

                  {!compact && combo.lore && (
                    <p className="text-xs leading-relaxed text-slate-400 italic">{combo.lore}</p>
                  )}

                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">包含设施</div>
                    <div className="flex flex-wrap gap-1">
                      {combo.facilityNames.map((name, idx) => (
                        <Badge key={`${combo.id}-fac-${idx}`} variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/5">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
