import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface JoinQueueFormProps {
  /** 提交加入队列请求（异步） */
  onJoin: (queueId: string) => Promise<void>;
}

/**
 * 加入队列表单：队列 ID 输入 + 加入按钮。
 *
 * 与 CreateRoomForm 视觉分组（紫色高亮 vs 蓝色高亮），形成「创建 vs 加入」的视觉对比。
 */
export function JoinQueueForm({ onJoin }: JoinQueueFormProps) {
  const [queueIdInput, setQueueIdInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    if (!queueIdInput.trim()) return;
    setIsJoining(true);
    await onJoin(queueIdInput.trim());
    setIsJoining(false);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">加入已有队列</div>
      <Input
        placeholder="队列 ID"
        value={queueIdInput}
        onChange={(e) => setQueueIdInput(e.target.value)}
        className="bg-slate-900/50 border-purple-500/20 text-white placeholder:text-slate-600"
      />
      <Button
        onClick={handleJoin}
        disabled={!queueIdInput.trim() || isJoining}
        className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500/30"
      >
        {isJoining ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            加入中...
          </>
        ) : (
          <>
            <Search className="w-4 h-4 mr-2" />
            加入队列
          </>
        )}
      </Button>
    </div>
  );
}
