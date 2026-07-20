import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BookOpen, HelpCircle } from 'lucide-react';
import { RULES_BUTTON_DEFAULT_LABEL } from '@/constants/rulesText';

export interface GameRulesButtonProps {
  onClick: () => void;
  /** 紧凑形态：仅显示图标（适合游戏内顶栏） */
  compact?: boolean;
  /** 自定义按钮标签（默认"游戏规则"） */
  label?: string;
  /** 自定义图标 */
  icon?: ReactNode;
  /** 附加 className */
  className?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 游戏规则触发按钮。
 * - 默认形态：图标 + 文字，用于首页/房间页主操作区
 * - compact 形态：仅图标，用于游戏页顶栏帮助入口
 */
export function GameRulesButton({
  onClick,
  compact,
  label = RULES_BUTTON_DEFAULT_LABEL,
  icon,
  className,
  disabled,
}: GameRulesButtonProps) {
  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={disabled}
        className={cn('w-8 h-8', className)}
        title={label}
        aria-label={label}
      >
        {icon ?? <HelpCircle className="w-4 h-4" />}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      className={cn('gap-2', className)}
    >
      {icon ?? <BookOpen className="w-4 h-4" />}
      {label}
    </Button>
  );
}
