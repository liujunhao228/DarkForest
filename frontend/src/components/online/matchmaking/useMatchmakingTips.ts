import { useEffect, useState } from 'react';
import { GAME_TIPS, TIP_INTERVAL_MS } from './matchmakingConstants';

/**
 * Tips 轮播 Hook：按固定间隔循环展示游戏提示。
 *
 * @returns 当前应展示的 tip 索引
 */
export function useMatchmakingTips(): number {
  const [currentTip, setCurrentTip] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTip((prev) => (prev + 1) % GAME_TIPS.length);
    }, TIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return currentTip;
}
