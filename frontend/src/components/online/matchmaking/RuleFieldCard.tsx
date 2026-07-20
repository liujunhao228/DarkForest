import { memo } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RuleFieldControl } from './RuleFieldControl';
import type { FieldMeta } from './customRulesConstants';
import type { ModeRules } from '@/lib/game/modeRules';

export interface RuleFieldCardProps {
  /** 字段元数据 */
  field: FieldMeta;
  /** 当前值 */
  value: ModeRules[keyof ModeRules];
  /** 该字段在当前 baseGameMode 下是否相关（不相关则灰显） */
  relevant: boolean;
  /** 值变更回调 */
  onChange: (v: boolean | number | string) => void;
  /** 是否禁用（如创建中） */
  disabled: boolean;
}

/**
 * 单个规则字段的卡片：label + 不适用 badge + control + description。
 *
 * 不相关字段（relevant=false）灰显但仍保留值，与原实现一致。
 */
function RuleFieldCardBase({ field, value, relevant, onChange, disabled }: RuleFieldCardProps) {
  return (
    <div
      className={`rounded-md border p-2.5 transition-opacity ${
        relevant ? 'border-slate-700 bg-slate-900/40' : 'border-slate-800 bg-slate-900/20 opacity-50'
      }`}
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
        <RuleFieldControl
          field={field}
          value={value}
          onChange={onChange}
          disabled={disabled || !relevant}
        />
      </div>
      <p className="text-[10px] text-slate-500 leading-snug">{field.description}</p>
    </div>
  );
}

export const RuleFieldCard = memo(RuleFieldCardBase);
