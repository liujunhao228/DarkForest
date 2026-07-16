import { useState } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Zap, Gem } from 'lucide-react';
import type { RelicDiscovery } from '@/lib/game/types';

// OnlineRelicRevealDialog: 继承遗迹/遗留物时的私有揭示弹窗。
// 数据源是 gameState.lastRelicDiscovery，后端 CreateViewState 已按 viewerID == playerId 门控，
// 仅继承者本人会拿到非 null 值，因此本组件无需再做身份判断。
// 弹窗可关闭；关闭后对同一 discoveryKey 不再重复弹出，新的继承事件会再次显示。
export function OnlineRelicRevealDialog() {
  const gameState = useOnlineGameStore(s => s.gameState);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  if (!gameState) return null;
  const discovery: RelicDiscovery | null | undefined = gameState.lastRelicDiscovery;
  if (!discovery) return null;

  // 用 JSON 序列化作为去重 key：discovery 内容不变则保持已关闭状态，内容变化则重新弹出。
  const discoveryKey = JSON.stringify(discovery);
  if (discoveryKey === dismissedKey) return null;

  const isRelic = !!discovery.isRelic;
  const facilityNames = discovery.facilityNames ?? [];
  const facilityCount = facilityNames.length;
  const handleDismiss = () => setDismissedKey(discoveryKey);

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) handleDismiss(); }}>
      <DialogContent className="bg-slate-900 border-cyan-900/50 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-cyan-400 flex items-center gap-2">
            <Gem className="w-5 h-5" />
            {isRelic ? `遗迹发现：「${discovery.name ?? '未命名遗迹'}」` : '继承遗留物'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            你在星系 {discovery.systemId} 继承了一份遗留物
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {isRelic && discovery.lore && (
            <div className="text-sm text-slate-300 italic bg-slate-800/50 border-l-2 border-cyan-700/50 p-3 rounded leading-relaxed">
              <div className="text-xs not-italic text-cyan-400/70 mb-1">—— 背景介绍</div>
              {discovery.lore}
            </div>
          )}
          {discovery.message && (
            <div className="text-sm text-amber-200 italic bg-slate-800/50 border-l-2 border-amber-700/50 p-3 rounded leading-relaxed">
              <div className="text-xs not-italic text-amber-400/70 mb-1">前人留言：</div>
              {discovery.message}
            </div>
          )}
          <div className="text-sm text-slate-300 flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1">
              <Zap className="w-4 h-4 text-yellow-500" />
              获得 <span className="font-bold text-yellow-400">{discovery.energy}</span> 点能量
            </span>
            <span className="text-slate-500">·</span>
            <span><span className="font-bold text-cyan-400">{facilityCount}</span> 个设施</span>
          </div>
          {facilityCount > 0 && (
            <div className="text-xs text-slate-400 flex flex-wrap gap-1.5 items-center">
              {facilityNames.map((name, i) => (
                <span key={`${name}-${i}`} className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300">{name}</span>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleDismiss} className="bg-cyan-600 hover:bg-cyan-700">知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
