import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import type { GameMode } from '@/lib/game/types';
import { getModeRules, type ModeRules } from '@/lib/game/modeRules';
import { BaseModeSelector } from './BaseModeSelector';
import { RuleFieldCard } from './RuleFieldCard';
import {
  FIELD_METAS,
  CATEGORY_META,
  CATEGORY_ORDER,
  MODE_LABELS,
  type FieldCategory,
} from './customRulesConstants';

/** 分类图标颜色（在组件内定义，确保 Tailwind 能扫描到完整类名字符串） */
const CATEGORY_ICON_COLOR: Record<FieldCategory, string> = {
  lightspeed: 'text-cyan-400',
  relic: 'text-amber-400',
  strike: 'text-red-400',
};

// ============================================================================
// Props
// ============================================================================

export interface CustomRulesEditorProps {
  /** 当前基础模式 */
  baseGameMode: GameMode;
  /** 当前自定义规则（null 表示用预设） */
  customRules: ModeRules | null;
  /** 规则变更回调，输出完整 ModeRules（13 字段） */
  onChange: (rules: ModeRules) => void;
  /** baseGameMode 切换回调 */
  onBaseGameModeChange: (mode: GameMode) => void;
  /** 是否禁用（如创建中） */
  disabled?: boolean;
}

// ============================================================================
// 组件
// ============================================================================

export function CustomRulesEditor({
  baseGameMode,
  customRules,
  onChange,
  onBaseGameModeChange,
  disabled = false,
}: CustomRulesEditorProps) {
  // 当前生效的规则：customRules 优先，否则用 baseGameMode 预设
  const effectiveRules: ModeRules = useMemo(
    () => customRules ?? getModeRules(baseGameMode),
    [customRules, baseGameMode],
  );

  const updateField = <K extends keyof ModeRules>(key: K, value: ModeRules[K]) => {
    onChange({ ...effectiveRules, [key]: value });
  };

  const handleReset = () => {
    // 重置为当前 baseGameMode 的预设
    onChange(getModeRules(baseGameMode));
  };

  const handleBaseModeChange = (mode: GameMode) => {
    // 切换基础模式时重置为对应预设
    onBaseGameModeChange(mode);
    onChange(getModeRules(mode));
  };

  // 按 category 分组
  const grouped = useMemo(() => {
    const map = new Map<typeof CATEGORY_ORDER[number], typeof FIELD_METAS>();
    for (const meta of FIELD_METAS) {
      const list = map.get(meta.category) ?? [];
      list.push(meta);
      map.set(meta.category, list);
    }
    return CATEGORY_ORDER.map((cat) => ({ category: cat, fields: map.get(cat) ?? [] }));
  }, []);

  // 是否有自定义修改（与预设不同）
  const isCustomized = useMemo(() => {
    const preset = getModeRules(baseGameMode);
    return JSON.stringify(preset) !== JSON.stringify(effectiveRules);
  }, [baseGameMode, effectiveRules]);

  return (
    <div className="space-y-4">
      {/* 基础模式选择 */}
      <BaseModeSelector
        baseGameMode={baseGameMode}
        isCustomized={isCustomized}
        disabled={disabled}
        onChange={handleBaseModeChange}
      />

      {/* 规则字段（按分类分组） */}
      {grouped.map(({ category, fields }) => {
        const meta = CATEGORY_META[category];
        const Icon = meta.icon;
        return (
          <div key={category} className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Icon className={`w-3.5 h-3.5 ${CATEGORY_ICON_COLOR[category]}`} />
              <span>{meta.label}</span>
            </div>
            <div className="space-y-2">
              {fields.map((field) => {
                const relevant = field.modes.includes(baseGameMode);
                const value = effectiveRules[field.key];
                return (
                  <RuleFieldCard
                    key={field.key}
                    field={field}
                    value={value}
                    relevant={relevant}
                    onChange={(v) => updateField(field.key, v as ModeRules[typeof field.key])}
                    disabled={disabled}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 恢复预设 */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || !isCustomized}
        onClick={handleReset}
        className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70 hover:text-slate-300"
      >
        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
        恢复为 {MODE_LABELS[baseGameMode]} 预设
      </Button>
    </div>
  );
}
