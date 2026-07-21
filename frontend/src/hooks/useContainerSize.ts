import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 监听指定 DOM 容器尺寸变化的 hook。
 *
 * 使用 ResizeObserver 而非 window resize 事件——能正确反映：
 * - flex/grid 父级压缩导致的容器尺寸变化
 * - aspect-ratio 撑高后的实际渲染尺寸
 * - 移动端键盘弹出/收起的容器收缩
 *
 * 容器未挂载或尺寸为 0 时返回零值，调用方需自行处理零值边界。
 */
export function useContainerSize<T extends Element>(): {
  ref: RefObject<T | null>;
  width: number;
  height: number;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 首帧立即同步一次，避免内容晚一帧出现（避免视觉闪烁）
    const rect = el.getBoundingClientRect();
    setSize((prev) =>
      prev.width === rect.width && prev.height === rect.height
        ? prev
        : { width: rect.width, height: rect.height },
    );

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
