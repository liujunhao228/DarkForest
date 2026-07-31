import { memo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFlyingStrikes, usePlayers } from '@/store/onlineGameStore/selectors';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { STRIKE_TIPS } from '@/constants/gameText';

function StrikeWarningBarComponent() {
  const flyingStrikes = useFlyingStrikes();
  const players = usePlayers();
  const localPlayerId = useLocalPlayerId();

  const humanPlayer = players.find(p => p.id === localPlayerId);
  if (!humanPlayer || humanPlayer.eliminated) return null;

  const hasIncomingArrivedStrike = flyingStrikes.some(
    s => s.arrived && s.targetSystem === humanPlayer.position && s.ownerId !== humanPlayer.id
  );
  if (!hasIncomingArrivedStrike) return null;

  // 悬停打击警告：当前玩家所在星系有待生效打击
  return (
    <div className="flex-shrink-0 px-4 py-1.5 bg-red-950/50 border-b border-red-900/50 animate-pulse">
      <span className="text-xs text-red-400 flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5" /> {STRIKE_TIPS.arrivingWarn}
      </span>
    </div>
  );
}

export const StrikeWarningBar = memo(StrikeWarningBarComponent);
StrikeWarningBar.displayName = 'StrikeWarningBar';
