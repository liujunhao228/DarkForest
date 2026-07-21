import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onPress?: () => void;
  delay?: number;
}

/**
 * 长按手势 hook：仅对触屏（pointerType === 'touch'）启用长按检测，
 * 鼠标点击保留原生 onClick 行为。
 *
 * - 长按达到 delay（默认 500ms）触发 onLongPress
 * - 未达长按阈值即松开则触发 onPress（用于替代触屏下的 onClick）
 * - 长按触发后标记 triggeredRef，松开时不再触发短按
 *
 * 返回值可直接展开到目标元素的 onPointerDown/Up/Leave/Cancel 上。
 */
export function useLongPress({ onLongPress, onPress, delay = 500 }: UseLongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggeredRef = useRef(false);

  const start = useCallback((e: React.PointerEvent) => {
    // 仅对触屏启用长按；鼠标保留 click
    if (e.pointerType !== 'touch') return;
    triggeredRef.current = false;
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      onLongPress();
    }, delay);
  }, [onLongPress, delay]);

  const clear = useCallback((e: React.PointerEvent) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // 仅触屏且未触发长按时触发短按
    if (e.pointerType === 'touch' && !triggeredRef.current && onPress) {
      onPress();
    }
  }, [onPress]);

  const cancel = useCallback((e: React.PointerEvent) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // pointerleave / pointercancel 不触发短按，仅清理
    void e;
  }, []);

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}
