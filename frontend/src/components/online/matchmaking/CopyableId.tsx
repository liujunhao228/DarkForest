import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface CopyableIdProps {
  /** 标签文案（如「队列 ID」、「房间号」） */
  label: string;
  /** 要展示和复制的值 */
  value: string;
  /** 是否为大号显示（房间号场景） */
  size?: 'sm' | 'lg';
  /** 副提示文案（如「分享队列 ID 邀请好友加入」） */
  hint?: string;
  /** 是否已复制（由调用方通过 useClipboardCopy 提供） */
  copied: boolean;
  /** 复制回调（由调用方通过 useClipboardCopy 提供） */
  onCopy: () => void;
  /** 附加内容（如右侧的 GameRulesButton） */
  trailing?: React.ReactNode;
}

/**
 * 可复制 ID 显示组件。
 *
 * 统一 queue 模式（队列 ID）与 room 模式（房间号）的展示样式：
 * - size="sm"：Badge 形式显示 ID
 * - size="lg"：大号等宽字体显示房间号
 * - 复制成功时整体短暂变绿微动画
 */
export function CopyableId({
  label,
  value,
  size = 'sm',
  hint,
  copied,
  onCopy,
  trailing,
}: CopyableIdProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="text-center space-y-2 flex-1">
        <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">{label}</div>
        <div className="flex items-center justify-center gap-2">
          {size === 'lg' ? (
            <motion.span
              animate={copied ? { scale: [1, 1.05, 1] } : { scale: 1 }}
              transition={{ duration: 0.3 }}
              className={`text-3xl font-bold font-mono tracking-wider ${
                copied ? 'text-green-400' : 'text-cyan-400'
              }`}
            >
              {value}
            </motion.span>
          ) : (
            <Badge
              variant="outline"
              className={`font-mono transition-colors ${
                copied ? 'border-green-500/50 text-green-400' : 'border-slate-500/50 text-slate-300'
              }`}
            >
              {label}: {value}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 bg-slate-800/50 hover:bg-slate-700/50 transition-all rounded-lg"
            onClick={onCopy}
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.span
                  key="check"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                >
                  <Check className="w-4 h-4 text-green-400" />
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                >
                  <Copy className="w-4 h-4 text-slate-400 hover:text-slate-300" />
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {trailing}
    </div>
  );
}
