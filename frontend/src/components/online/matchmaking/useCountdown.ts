import { useEffect, useState } from 'react';
import { COUNTDOWN_TICK_MS } from './matchmakingConstants';

/**
 * 倒计时显示 Hook：将 countdownEndsAt（绝对时间戳）转换为剩余秒数。
 *
 * - countdownEndsAt 为 null 时返回 null（无倒计时）
 * - 倒计时结束后固定显示 0
 * - 每 COUNTDOWN_TICK_MS 毫秒刷新一次显示
 *
 * @param countdownEndsAt 倒计时结束的绝对时间戳（毫秒），null 表示无倒计时
 * @returns 剩余秒数（null 表示无倒计时）
 */
export function useCountdown(countdownEndsAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (countdownEndsAt === null) {
      // 同步清空倒计时显示，属于合法的 effect 状态同步
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemaining(null);
      return;
    }

    const update = () => {
      const left = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000));
      setRemaining(left);
    };
    update();
    const timer = setInterval(update, COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [countdownEndsAt]);

  return remaining;
}
