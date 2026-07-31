import { memo, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { useFlyingStrikes, usePlayers, usePendingAction } from '@/store/onlineGameStore/selectors';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { STRIKE_SHAPES, getOwnerColor } from '@/lib/game/strikeStyles';
import { StrikeShapeIcon } from './StrikeShapeIcon';
import { STRIKE_TIPS } from '@/constants/gameText';

// P2-2 Task 3: 从 OnlineBoard.renderFlyingStrikes 提取的独立 memo 子组件。
// 无 props，全部通过 selector 订阅 onlineGameStore，避免 OnlineBoard 其他字段
// 变化（pendingAction/isProcessing/roomPlayers 等）触发本列表重渲染。
function FlyingStrikesListComponent() {
  const flyingStrikes = useFlyingStrikes();
  const players = usePlayers();
  const pendingAction = usePendingAction();
  const localPlayerId = useLocalPlayerId();

  // P0-B1: 构建 playersById 索引，替代每次渲染时的 players.find O(n) 扫描
  const playersById = useMemo(() => {
    const map = new Map<string, typeof players[number]>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  const localPlayerIdFromState = localPlayerId || undefined;

  if (flyingStrikes.length === 0) return null;

  return (
    <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-2">
      <div className="text-xs font-bold text-red-400 mb-2 flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> {STRIKE_TIPS.flyingTitle}</div>
      {flyingStrikes.map((strike) => {
        const owner = playersById.get(strike.ownerId);
        const isOwn = strike.ownerId === localPlayerIdFromState;
        const isPendingMove = !!pendingAction && typeof pendingAction === 'object' && 'strikeUid' in pendingAction && (pendingAction as { strikeUid: string }).strikeUid === strike.uid;
        const ownerColor = getOwnerColor(strike.ownerId, players);
        const shape = STRIKE_SHAPES[strike.defId] ?? 'circle';
        return (
          <div key={strike.uid} className={`text-[10px] text-slate-400 mb-1 p-1.5 bg-red-950/20 rounded ${isPendingMove ? 'ring-1 ring-red-500/50' : ''}`}
            style={{ borderLeft: `2px solid ${ownerColor}` }}>
            <div className="text-red-300 font-bold flex items-center gap-1">
              <StrikeShapeIcon shape={shape} color={ownerColor} className="w-3 h-3 flex-shrink-0" />
              {strike.strikeName} (Lv.{strike.level}){strike.arrived && ` · ${STRIKE_TIPS.standby}`}
            </div>
            <div>{STRIKE_TIPS.owner}: {owner?.name}{isOwn ? ` ${STRIKE_TIPS.self}` : ''}</div>
            <div>{STRIKE_TIPS.position}: {strike.position} → {STRIKE_TIPS.target}: {strike.targetSystem}</div>
          </div>
        );
      })}
    </div>
  );
}

export const FlyingStrikesList = memo(FlyingStrikesListComponent);
