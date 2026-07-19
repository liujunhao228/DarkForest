import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RotateCcw, Sparkles, Crown, Crosshair } from 'lucide-react';
import type { GameMode } from '@/lib/game/types';
import { getModeRules, type ModeRules } from '@/lib/game/modeRules';

// ============================================================================
// 字段元数据 — 与后端 mode_rules.go 字段对齐
// ============================================================================

type FieldType = 'boolean' | 'integer' | 'enum';
type FieldCategory = 'lightspeed' | 'relic' | 'strike';

interface EnumOpt {
  id: string;
  label: string;
}

interface FieldMeta {
  key: keyof ModeRules;
  label: string;
  category: FieldCategory;
  type: FieldType;
  unit?: string;
  description: string;
  enumOptions?: EnumOpt[];
  /** 该字段在哪些基础模式下"相关"（可编辑）；不相关字段灰显但仍保留值 */
  modes: GameMode[];
}

const FIELD_METAS: FieldMeta[] = [
  // lightspeed
  {
    key: 'lightspeedOneTime',
    label: '光速飞船使用方式',
    category: 'lightspeed',
    type: 'boolean',
    description: 'true=一次性（Classic，跃迁后消失）；false=可重复部署（Relics）',
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'lightspeedCombinedActionCost',
    label: '合并动作成本（随机）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Classic 模式下光速飞船合并动作的随机成本',
    modes: ['classic'],
  },
  {
    key: 'lightspeedCombinedActionCostSpecified',
    label: '合并动作成本（指定）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Classic 模式下光速飞船合并动作的指定成本',
    modes: ['classic'],
  },
  {
    key: 'lightspeedDeployCost',
    label: '部署成本',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Relics 模式下光速飞船的部署成本',
    modes: ['civilization_relics'],
  },
  {
    key: 'lightspeedJumpCostRandom',
    label: '跃迁成本（随机）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Relics 模式下光速飞船跃迁至随机星系的成本',
    modes: ['civilization_relics'],
  },
  {
    key: 'lightspeedJumpCostSpecified',
    label: '跃迁成本（指定）',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: 'Relics 模式下光速飞船跃迁至指定星系的成本',
    modes: ['civilization_relics'],
  },
  {
    key: 'lightspeedCarryCap',
    label: '携带能量上限',
    category: 'lightspeed',
    type: 'integer',
    unit: '能量',
    description: '光速飞船可携带的能量上限',
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'lightspeedMessageEnabled',
    label: '是否启用留言',
    category: 'lightspeed',
    type: 'boolean',
    description: '光速飞船离开星系时是否可留言',
    modes: ['classic', 'civilization_relics'],
  },
  // relic
  {
    key: 'relicDistributionEnabled',
    label: '遗迹分布',
    category: 'relic',
    type: 'boolean',
    description: '是否在星图上分布遗迹（Relics 默认开启）',
    modes: ['classic', 'civilization_relics'],
  },
  // strike
  {
    key: 'strikeOrigin',
    label: '打击出现位置',
    category: 'strike',
    type: 'enum',
    description: 'direct=即刻判定；ownerPlanet=从拥有者星球飞行；stealthOwnerPlanet=隐逐跳（路径仅拥有者可见）',
    enumOptions: [
      { id: 'direct', label: '即刻判定' },
      { id: 'ownerPlanet', label: '从拥有者星球飞行' },
      { id: 'stealthOwnerPlanet', label: '隐逐跳' },
    ],
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'strikeMissBehavior',
    label: '打击落空处理',
    category: 'strike',
    type: 'enum',
    description: 'discard=废弃；freeControl=保留可自由控制；requireTarget=保留必须先指定新目标',
    enumOptions: [
      { id: 'discard', label: '废弃到弃牌堆' },
      { id: 'freeControl', label: '保留可自由控制' },
      { id: 'requireTarget', label: '保留须指定新目标' },
    ],
    modes: ['classic', 'civilization_relics'],
  },
  {
    key: 'strikeCanDestroyRelic',
    label: '打击可摧毁遗迹',
    category: 'strike',
    type: 'boolean',
    description: '打击到达目标后是否可摧毁该星系的遗迹（Relics 默认 true）',
    modes: ['classic', 'civilization_relics'],
  },
];

const CATEGORY_META: Record<FieldCategory, { label: string; icon: React.ReactNode }> = {
  lightspeed: { label: '光速飞船', icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> },
  relic: { label: '遗迹', icon: <Crown className="w-3.5 h-3.5 text-amber-400" /> },
  strike: { label: '打击', icon: <Crosshair className="w-3.5 h-3.5 text-red-400" /> },
};

const CATEGORY_ORDER: FieldCategory[] = ['lightspeed', 'relic', 'strike'];

const MODE_LABELS: Record<GameMode, string> = {
  classic: '经典模式',
  civilization_relics: '文明遗迹模式',
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
    const map = new Map<FieldCategory, FieldMeta[]>();
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
      <div className="space-y-2">
        <Label className="text-xs text-slate-400 uppercase tracking-wider">基础游戏模式</Label>
        <div className="flex gap-2">
          {(['classic', 'civilization_relics'] as GameMode[]).map((mode) => (
            <Button
              key={mode}
              type="button"
              variant={baseGameMode === mode ? 'default' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => handleBaseModeChange(mode)}
              className={`flex-1 ${baseGameMode === mode ? 'bg-sky-500/20 text-sky-400 border-sky-500/50' : 'border-slate-700 text-slate-400'}`}
            >
              {MODE_LABELS[mode]}
            </Button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-slate-500">
            选择基础模式后可微调具体规则，切换模式会重置为对应预设。
          </p>
          {isCustomized && (
            <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">
              已自定义
            </Badge>
          )}
        </div>
      </div>

      {/* 规则字段 */}
      {grouped.map(({ category, fields }) => {
        const meta = CATEGORY_META[category];
        return (
          <div key={category} className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              {meta.icon}
              <span>{meta.label}</span>
            </div>
            <div className="space-y-2">
              {fields.map((field) => {
                const relevant = field.modes.includes(baseGameMode);
                const value = effectiveRules[field.key];
                return (
                  <div
                    key={field.key}
                    className={`rounded-md border p-2.5 transition-opacity ${relevant ? 'border-slate-700 bg-slate-900/40' : 'border-slate-800 bg-slate-900/20 opacity-50'}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Label className="text-xs font-medium text-slate-200 truncate">{field.label}</Label>
                      {!relevant && (
                        <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-500 flex-shrink-0">
                          不适用
                        </Badge>
                      )}
                    </div>
                    <div className="mb-1.5">
                      {renderControl(field, value, (v) => updateField(field.key, v as ModeRules[typeof field.key]), disabled || !relevant)}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug">{field.description}</p>
                  </div>
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

// ============================================================================
// 控件渲染
// ============================================================================

function renderControl(
  field: FieldMeta,
  value: ModeRules[keyof ModeRules],
  onChange: (v: boolean | number | string) => void,
  disabled: boolean,
): React.ReactNode {
  switch (field.type) {
    case 'boolean': {
      const boolVal = value as boolean;
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(!boolVal)}
          className={`w-full justify-center ${boolVal ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-slate-800/50 text-slate-500 border-slate-700'}`}
        >
          {boolVal ? '✓ 启用' : '✗ 禁用'}
        </Button>
      );
    }
    case 'integer': {
      const numVal = value as number;
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={numVal}
            disabled={disabled}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange(Number.isFinite(n) ? n : 0);
            }}
            className="bg-slate-900/50 border-slate-700 text-white text-sm h-8"
          />
          {field.unit && <span className="text-[10px] text-slate-500 flex-shrink-0">{field.unit}</span>}
        </div>
      );
    }
    case 'enum': {
      const strVal = value as string;
      return (
        <Select
          value={strVal}
          disabled={disabled}
          onValueChange={onChange}
        >
          <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white text-sm h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.enumOptions?.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    default:
      return null;
  }
}
