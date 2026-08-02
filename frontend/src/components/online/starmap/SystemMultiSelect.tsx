import { memo } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

/**
 * 多选星系下拉框。移动端标记模式 region 工具用，替代触屏星图多选。
 * toggle 选择集（不关闭弹窗），沿用父组件"确认"按钮提交区域注释。
 *
 * 仅展示"星系 N"，不提供驻留玩家等额外信息——与桌面端星图点击信息对等（公平性）。
 */
interface SystemMultiSelectProps {
  /** 可选星系列表（标记模式 = 全部 1-9） */
  systems: number[];
  /** 当前已选星系集合 */
  selectedSystems: Set<number>;
  /** toggle 单个星系（与桌面端 marking region 点击等效） */
  onToggle: (systemId: number) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 触发器 placeholder */
  placeholder?: string;
}

function SystemMultiSelectComponent({ systems, selectedSystems, onToggle, disabled, placeholder = '选择星系' }: SystemMultiSelectProps) {
  const count = selectedSystems.size;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className="min-h-[28px] text-xs px-2"
        >
          {count > 0 ? `已选 ${count}` : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1 max-h-[50vh] overflow-y-auto" align="start">
        {systems.map((id) => {
          const selected = selectedSystems.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              className="flex items-center gap-2 w-full min-h-[36px] px-2 py-1 rounded text-xs text-left hover:bg-slate-700/50 transition-colors"
              aria-pressed={selected}
            >
              <span className="w-4 flex items-center justify-center">
                {selected && <Check className="w-3.5 h-3.5 text-amber-400" />}
              </span>
              <span className="text-slate-200">星系 {id}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export const SystemMultiSelect = memo(SystemMultiSelectComponent);
