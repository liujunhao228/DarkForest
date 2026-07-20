import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FieldMeta } from './customRulesConstants';
import type { ModeRules } from '@/lib/game/modeRules';

export interface RuleFieldControlProps {
  /** 字段元数据 */
  field: FieldMeta;
  /** 当前值（联合类型，由 field.type 决定实际类型） */
  value: ModeRules[keyof ModeRules];
  /** 值变更回调 */
  onChange: (v: boolean | number | string) => void;
  /** 是否禁用 */
  disabled: boolean;
}

/**
 * 规则字段控件：根据 field.type 渲染 boolean / integer / enum 三种控件。
 *
 * 改进点：
 * - 由函数改造为组件，支持 React.memo
 * - 内部用 typeof 收窄类型，消除 `value as boolean` 强制转换
 */
function RuleFieldControlBase({ field, value, onChange, disabled }: RuleFieldControlProps) {
  switch (field.type) {
    case 'boolean': {
      // typeof 收窄，避免强制转换
      const boolVal = typeof value === 'boolean' ? value : Boolean(value);
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(!boolVal)}
          className={`w-full justify-center ${
            boolVal
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
              : 'bg-slate-800/50 text-slate-500 border-slate-700'
          }`}
        >
          {boolVal ? '✓ 启用' : '✗ 禁用'}
        </Button>
      );
    }
    case 'integer': {
      const numVal = typeof value === 'number' ? value : Number(value);
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
          {field.unit && (
            <span className="text-[10px] text-slate-500 flex-shrink-0">{field.unit}</span>
          )}
        </div>
      );
    }
    case 'enum': {
      const strVal = typeof value === 'string' ? value : String(value);
      return (
        <Select value={strVal} disabled={disabled} onValueChange={onChange}>
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

export const RuleFieldControl = memo(RuleFieldControlBase);
