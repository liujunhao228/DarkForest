import { memo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * 单选星系下拉框。移动端用于替代触屏星图选中（解决星系节点密集导致的命中困难）。
 * 选中即触发 onSelect（与桌面端点击星图等效，无额外确认步）。
 *
 * 仅展示"星系 N"，不提供驻留玩家/距离等额外信息——与桌面端星图点击信息对等（公平性）。
 */
interface SystemSelectProps {
  /** 可选星系列表（已由调用方按 validMoves/highlightSystems/allowedSystems 过滤） */
  systems: number[];
  /** 当前选中星系（受控；不传则非受控） */
  value?: number;
  /** 选中回调，立即触发（与桌面端 onSystemClick 等效） */
  onSelect: (systemId: number) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 触发器 placeholder */
  placeholder?: string;
}

function SystemSelectComponent({ systems, value, onSelect, disabled, placeholder = '选择星系' }: SystemSelectProps) {
  // Radix Select 的 value 只接受 string；用 String/Number 显式转换，避免 as any
  return (
    <Select
      value={value !== undefined ? String(value) : undefined}
      onValueChange={(v) => onSelect(Number(v))}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className="w-full min-h-[28px] text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[50vh]">
        {systems.map((id) => (
          <SelectItem key={id} value={String(id)} className="text-xs">
            星系 {id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const SystemSelect = memo(SystemSelectComponent);
