import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GameMode } from '@/lib/game/types';
import type { RuleConfig, RuleConfigCategory, RuleConfigValue } from '@/api/rules';
import { formatConfigValue, renderRuleCellValue } from '@/api/rules';

// ============================================================================
// 分组元数据
// ============================================================================

const CATEGORY_ORDER: RuleConfigCategory[] = ['lightspeed', 'relic', 'strike'];

const CATEGORY_LABELS: Record<RuleConfigCategory, string> = {
  lightspeed: '光速飞船',
  relic: '遗迹',
  strike: '打击',
};

const CATEGORY_DESCRIPTIONS: Record<RuleConfigCategory, string> = {
  lightspeed: '光速飞船的使用方式与跃迁成本',
  relic: '遗迹分布与遗迹相关规则',
  strike: '打击出现位置、落空处理与命中规则',
};

const MODE_LABELS: Record<GameMode, string> = {
  classic: '经典模式',
  civilization_relics: '文明遗迹模式',
};

const MODE_ACCENT: Record<GameMode, string> = {
  classic: 'text-cyan-300',
  civilization_relics: 'text-purple-300',
};

// ============================================================================
// 工具函数
// ============================================================================

interface GroupedConfigs {
  category: RuleConfigCategory;
  label: string;
  description: string;
  configs: RuleConfig[];
}

function groupByCategory(configs: RuleConfig[]): GroupedConfigs[] {
  const map = new Map<RuleConfigCategory, RuleConfig[]>();
  for (const cfg of configs) {
    const list = map.get(cfg.category) ?? [];
    list.push(cfg);
    map.set(cfg.category, list);
  }
  const result: GroupedConfigs[] = [];
  for (const cat of CATEGORY_ORDER) {
    const list = map.get(cat);
    if (list && list.length > 0) {
      result.push({
        category: cat,
        label: CATEGORY_LABELS[cat],
        description: CATEGORY_DESCRIPTIONS[cat],
        configs: list,
      });
    }
  }
  return result;
}

function isDifferentBetweenModes(cfg: RuleConfig): boolean {
  const classic = cfg.values.classic;
  const relics = cfg.values.civilization_relics;
  return formatConfigValue(classic) !== formatConfigValue(relics);
}

// ============================================================================
// ModeRulesCompare
// ============================================================================

export interface ModeRulesCompareProps {
  ruleConfigs: RuleConfig[];
  /** 当前高亮的模式（mode-filtered / compact 模式下使用） */
  activeGameMode?: GameMode;
  /** 是否仅展示 activeGameMode 一列（compact 模式下使用） */
  singleMode?: boolean;
}

interface CellProps {
  config: RuleConfig;
  mode: GameMode;
  highlight: boolean;
}

function Cell({ config, mode, highlight }: CellProps) {
  const value = config.values[mode];
  if (value === undefined) {
    return <td className="px-3 py-2 text-slate-600 text-center">—</td>;
  }

  const display = renderRuleCellValue(config, value as RuleConfigValue);
  const descKey = `${mode}.${formatConfigValue(value)}`;
  const desc = config.descriptions[descKey];

  const cell = (
    <td
      className={cn(
        'px-3 py-2 text-sm align-top',
        highlight ? 'bg-slate-800/60 text-slate-100' : 'text-slate-300',
      )}
    >
      {display}
    </td>
  );

  if (!desc) return cell;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <td
          className={cn(
            'px-3 py-2 text-sm align-top cursor-help border-b border-dashed border-slate-700/40',
            highlight ? 'bg-slate-800/60 text-slate-100' : 'text-slate-300',
          )}
        >
          {display}
        </td>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-slate-900 border border-slate-700 text-slate-100 max-w-xs whitespace-normal text-left"
      >
        <p className="text-xs leading-relaxed">{desc}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function ModeRulesCompare({ ruleConfigs, activeGameMode, singleMode }: ModeRulesCompareProps) {
  const groups = useMemo(() => groupByCategory(ruleConfigs), [ruleConfigs]);
  const modes: GameMode[] = singleMode && activeGameMode
    ? [activeGameMode]
    : ['classic', 'civilization_relics'];

  return (
    <div className="space-y-5">
      {/* 模式说明卡 */}
      {!singleMode && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(['classic', 'civilization_relics'] as GameMode[]).map((mode) => (
            <div
              key={mode}
              className={cn(
                'rounded-lg border p-3 text-sm',
                activeGameMode === mode
                  ? 'border-cyan-500/50 bg-cyan-500/5'
                  : 'border-slate-700 bg-slate-900/40',
              )}
            >
              <div className={cn('font-semibold mb-0.5', MODE_ACCENT[mode])}>{MODE_LABELS[mode]}</div>
              <div className="text-xs text-slate-400">
                {mode === 'classic'
                  ? '快速直接的星际博弈，打击即刻判定，光速飞船一次性使用'
                  : '打击需要飞行到达，星系间散布远古文明遗迹，光速飞船可复用并支持留言'}
              </div>
            </div>
          ))}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.category} className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{group.label}</h3>
            <p className="text-xs text-slate-500">{group.description}</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-800">
                  <th className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">配置项</th>
                  {modes.map((mode) => (
                    <th
                      key={mode}
                      className={cn(
                        'px-3 py-2 text-xs font-semibold uppercase tracking-wider',
                        activeGameMode === mode ? MODE_ACCENT[mode] : 'text-slate-400',
                      )}
                    >
                      {MODE_LABELS[mode]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.configs.map((cfg) => {
                  const diff = !singleMode && isDifferentBetweenModes(cfg);
                  return (
                    <tr
                      key={cfg.key}
                      className={cn(
                        'border-b border-slate-800/60 last:border-b-0',
                        diff && 'bg-amber-500/5',
                      )}
                    >
                      <td className="px-3 py-2 text-sm text-slate-200 align-top">
                        <div>{cfg.name}</div>
                        {diff && (
                          <span className="inline-block mt-0.5 text-[10px] text-amber-400/80">两模式有差异</span>
                        )}
                      </td>
                      {modes.map((mode) => (
                        <Cell
                          key={mode}
                          config={cfg}
                          mode={mode}
                          highlight={activeGameMode === mode}
                        />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
