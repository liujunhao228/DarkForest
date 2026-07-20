import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { GameMode } from '@/lib/game/types';
import { MODE_LABELS } from './customRulesConstants';

export interface BaseModeSelectorProps {
  /** 当前基础模式 */
  baseGameMode: GameMode;
  /** 是否有自定义修改（与预设不同） */
  isCustomized: boolean;
  /** 是否禁用 */
  disabled: boolean;
  /** 基础模式切换回调 */
  onChange: (mode: GameMode) => void;
}

/**
 * 基础游戏模式选择器：classic / civilization_relics 二选一。
 *
 * 含「已自定义」徽章提示，告知用户当前是否偏离预设。
 */
export function BaseModeSelector({
  baseGameMode,
  isCustomized,
  disabled,
  onChange,
}: BaseModeSelectorProps) {
  const modes: GameMode[] = ['classic', 'civilization_relics'];

  return (
    <div className="space-y-2">
      <Label className="text-xs text-slate-400 uppercase tracking-wider">基础游戏模式</Label>
      <div className="flex gap-2">
        {modes.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant={baseGameMode === mode ? 'default' : 'outline'}
            size="sm"
            disabled={disabled}
            onClick={() => onChange(mode)}
            className={`flex-1 ${
              baseGameMode === mode
                ? 'bg-sky-500/20 text-sky-400 border-sky-500/50'
                : 'border-slate-700 text-slate-400'
            }`}
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
  );
}
