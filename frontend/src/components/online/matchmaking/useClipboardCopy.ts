import { useCallback, useRef, useState } from 'react';
import { COPY_FEEDBACK_MS } from './matchmakingConstants';

/**
 * 剪贴板复制 Hook：封装 navigator.clipboard.writeText + 反馈状态。
 *
 * - 支持并发安全：通过 ref 跟踪当前计时器，重复复制仅保留最后一次反馈
 * - 失败时静默（与原实现一致），不抛错
 *
 * @returns `{ copied, copy }` — copied 表示是否处于"已复制"反馈窗口
 */
export function useClipboardCopy(): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  }, []);

  return { copied, copy };
}
