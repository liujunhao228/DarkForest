import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { GameMode } from '@/lib/game/types';
import type { ModeRules } from '@/lib/game/modeRules';
import { CustomRulesEditor } from './CustomRulesEditor';
import { PLAYER_COUNT_OPTIONS } from './matchmakingConstants';

export interface CreateRoomFormSubmit {
  queueName: string;
  playerCount: number;
  baseGameMode: GameMode;
  customRules: ModeRules | null;
}

export interface CreateRoomFormProps {
  /** 提交创建房间请求（异步） */
  onCreate: (params: CreateRoomFormSubmit) => Promise<void>;
}

/**
 * 创建房间表单：房间名输入 + 人数选择 + 可选规则编辑器 + 创建按钮。
 *
 * 状态隔离在组件内部，Matchmaking 容器仅通过 onCreate 回调接收结果。
 */
export function CreateRoomForm({ onCreate }: CreateRoomFormProps) {
  const [queueName, setQueueName] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [baseGameMode, setBaseGameMode] = useState<GameMode>('classic');
  const [customRules, setCustomRules] = useState<ModeRules | null>(null);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!queueName.trim()) return;
    setIsCreating(true);
    await onCreate({ queueName, playerCount, baseGameMode, customRules });
    setIsCreating(false);
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">创建自定义房间</div>
      <Input
        placeholder="房间名称"
        value={queueName}
        onChange={(e) => setQueueName(e.target.value)}
        className="bg-slate-900/50 border-sky-500/20 text-white placeholder:text-slate-600"
      />
      <div className="flex gap-2">
        {PLAYER_COUNT_OPTIONS.map((count) => (
          <Button
            key={count}
            variant={playerCount === count ? 'default' : 'outline'}
            size="sm"
            onClick={() => setPlayerCount(count)}
            className={`flex-1 ${
              playerCount === count
                ? 'bg-sky-500/20 text-sky-400 border-sky-500/50'
                : 'border-slate-700 text-slate-400'
            }`}
          >
            {count}人
          </Button>
        ))}
      </div>
      <Button
        onClick={handleCreate}
        disabled={!queueName.trim() || isCreating}
        className="w-full bg-sky-500/20 text-sky-400 border border-sky-500/50 hover:bg-sky-500/30"
      >
        {isCreating ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            创建中...
          </>
        ) : (
          <>
            <Plus className="w-4 h-4 mr-2" />
            创建 {playerCount} 人房间
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setShowRulesEditor((v) => !v)}
        className="w-full text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
      >
        {showRulesEditor ? '收起高级规则' : '自定义规则（可选）'}
      </Button>
      {showRulesEditor && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="rounded-lg border border-slate-700 bg-slate-900/30 p-3 max-h-[40vh] overflow-y-auto"
        >
          <CustomRulesEditor
            baseGameMode={baseGameMode}
            customRules={customRules}
            onChange={setCustomRules}
            onBaseGameModeChange={setBaseGameMode}
            disabled={isCreating}
          />
        </motion.div>
      )}
    </div>
  );
}
