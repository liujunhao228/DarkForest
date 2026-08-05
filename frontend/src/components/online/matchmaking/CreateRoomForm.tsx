import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { GameMode } from '@/lib/game/types';
import type { ModeRules } from '@/lib/game/modeRules';
import { listMaps, type MapData } from '@/api/maps';
import { uploadMapFile } from '@/lib/game/mapFile';
import { CustomRulesEditor } from './CustomRulesEditor';
import { PLAYER_COUNT_OPTIONS } from './matchmakingConstants';

export interface CreateRoomFormSubmit {
  queueName: string;
  playerCount: number;
  baseGameMode: GameMode;
  customRules: ModeRules | null;
  /**
   * P3: 自定义房间所选地图 UUID。
   * - undefined / 空串 = 官方默认地图（classic-9，与快匹配行为一致）
   * - 非空串 = 房主上传或选中的官方地图 UUID
   */
  mapId?: string;
}

export interface CreateRoomFormProps {
  /** 提交创建房间请求（异步） */
  onCreate: (params: CreateRoomFormSubmit) => Promise<void>;
}

/**
 * 创建房间表单：房间名输入 + 人数选择 + 对局地图选择 + 可选规则编辑器 + 创建按钮。
 *
 * 状态隔离在组件内部，Matchmaking 容器仅通过 onCreate 回调接收结果。
 *
 * P3：新增"对局地图"区块，支持：
 *   - 下拉选择官方地图（含"使用默认地图"选项）
 *   - 上传 .dfmap.json / .json 文件作为自定义地图（受 10 张/用户配额约束）
 */
export function CreateRoomForm({ onCreate }: CreateRoomFormProps) {
  const [queueName, setQueueName] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [baseGameMode, setBaseGameMode] = useState<GameMode>('classic');
  const [customRules, setCustomRules] = useState<ModeRules | null>(null);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // P3: 地图选择状态
  const [officialMaps, setOfficialMaps] = useState<MapData[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string>('');
  const [isUploadingMap, setIsUploadingMap] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 挂载时拉取官方地图列表
  useEffect(() => {
    let cancelled = false;
    listMaps()
      .then((maps) => {
        if (!cancelled) setOfficialMaps(maps);
      })
      .catch((err) => {
        // 拉取失败不阻塞表单，仅 console.error（用户仍可用默认地图）
        console.error('[CreateRoomForm] 拉取官方地图列表失败:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUploadMap = async (file: File) => {
    if (!file) return;
    setIsUploadingMap(true);
    try {
      // 默认名称用文件名（去扩展名），避免空名被后端拒绝
      const defaultName = file.name.replace(/\.(dfmap\.json|json)$/i, '');
      const created = await uploadMapFile(file, defaultName);
      // 上传成功：把新地图加入本地列表并自动选中
      setOfficialMaps((prev) => [created, ...prev.filter((m) => m.id !== created.id)]);
      setSelectedMapId(created.id);
      toast.success(`地图「${created.name}」上传成功，已自动选中`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`地图上传失败：${msg}`);
    } finally {
      setIsUploadingMap(false);
      // 清空 input value 以便同一文件可再次选择
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreate = async () => {
    if (!queueName.trim()) return;
    setIsCreating(true);
    await onCreate({
      queueName,
      playerCount,
      baseGameMode,
      customRules,
      // 空串 → undefined（后端视为 NULL = 官方默认地图）
      mapId: selectedMapId || undefined,
    });
    setIsCreating(false);
  };

  const isBusy = isCreating || isUploadingMap;

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

      {/* P3: 对局地图选择 */}
      <div className="space-y-1.5">
        <Label className="text-xs text-slate-400 uppercase tracking-wider">对局地图</Label>
        <select
          value={selectedMapId}
          onChange={(e) => setSelectedMapId(e.target.value)}
          disabled={isBusy}
          className="w-full h-9 rounded-md bg-slate-900/50 border border-sky-500/20 text-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500/50 disabled:opacity-50"
        >
          <option value="">使用默认地图（classic-9）</option>
          {officialMaps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.isOfficial ? '（官方）' : '（个人）'}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".dfmap.json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUploadMap(f);
            }}
            disabled={isBusy}
            className="hidden"
            id="map-file-input"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800/50"
          >
            {isUploadingMap ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                上传自定义地图
              </>
            )}
          </Button>
        </div>
        <p className="text-[10px] text-slate-500">
          支持 .dfmap.json / .json 格式；普通用户上限 10 张
        </p>
      </div>

      <Button
        onClick={handleCreate}
        disabled={!queueName.trim() || isBusy}
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
