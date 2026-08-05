import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { GameMode } from '@/lib/game/types';
import type { ModeRules } from '@/lib/game/modeRules';
import { listMaps, getMap, type MapData } from '@/api/maps';
import { CustomRulesEditor } from './CustomRulesEditor';
import { PLAYER_COUNT_OPTIONS } from './matchmakingConstants';

/** UUID v1-5 不区分大小写正则（与后端 uuid.Parse 宽松一致）。 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateRoomFormSubmit {
  queueName: string;
  playerCount: number;
  baseGameMode: GameMode;
  customRules: ModeRules | null;
  /**
   * 自定义房间所选地图 UUID。
   * - undefined / 空串 = 官方默认地图（classic-9，与快匹配行为一致）
   * - 非空串 = 房主粘贴的 map ID 或下拉选中的官方地图 UUID
   *
   * 优先级：map ID 输入框（预览通过）> 官方下拉 > undefined（默认）。
   */
  mapId?: string;
}

export interface CreateRoomFormProps {
  /** 提交创建房间请求（异步） */
  onCreate: (params: CreateRoomFormSubmit) => Promise<void>;
}

/**
 * 创建房间表单：房间名 + 人数 + 对局地图（官方下拉 + map ID 输入）+ 可选规则编辑器。
 *
 * 状态隔离在组件内部，Matchmaking 容器仅通过 onCreate 回调接收结果。
 *
 * 地图选图：
 *   - 官方下拉：默认 classic-9 或选官方地图
 *   - map ID 输入框：粘贴 map ID（含个人/他人/官方图），失焦调 getMap 预览
 *   - 提交时 ID 输入框（预览通过）优先于下拉；二者皆空 = 默认地图
 */
export function CreateRoomForm({ onCreate }: CreateRoomFormProps) {
  const [queueName, setQueueName] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [baseGameMode, setBaseGameMode] = useState<GameMode>('classic');
  const [customRules, setCustomRules] = useState<ModeRules | null>(null);
  const [showRulesEditor, setShowRulesEditor] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // 官方地图下拉状态
  const [officialMaps, setOfficialMaps] = useState<MapData[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string>('');

  // map ID 输入框状态：输入 + 预览 + 错误
  const [mapIdInput, setMapIdInput] = useState('');
  const [mapIdPreview, setMapIdPreview] = useState<{ name: string; nodeCount: number } | null>(null);
  const [mapIdError, setMapIdError] = useState<string | null>(null);

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

  // 输入变化时清空预览/错误（不发请求，等失焦再校验）
  const handleMapIdChange = (value: string) => {
    setMapIdInput(value);
    setMapIdPreview(null);
    setMapIdError(null);
  };

  // 失焦时校验：空→清空；非 UUID→格式错误；UUID→getMap 预览或「地图不存在」
  const handleMapIdBlur = async () => {
    const trimmed = mapIdInput.trim();
    if (trimmed === '') {
      setMapIdPreview(null);
      setMapIdError(null);
      return;
    }
    if (!UUID_REGEX.test(trimmed)) {
      setMapIdPreview(null);
      setMapIdError('地图 ID 格式错误');
      return;
    }
    try {
      const map = await getMap(trimmed);
      setMapIdPreview({ name: map.name, nodeCount: map.layoutJson.nodes.length });
      setMapIdError(null);
    } catch {
      setMapIdPreview(null);
      setMapIdError('地图不存在');
    }
  };

  const handleCreate = async () => {
    if (!queueName.trim()) return;
    // 优先级：map ID 输入框（预览通过）> 官方下拉 > undefined（默认）
    const finalMapId =
      mapIdInput.trim() && mapIdPreview ? mapIdInput.trim() : selectedMapId || undefined;
    setIsCreating(true);
    await onCreate({
      queueName,
      playerCount,
      baseGameMode,
      customRules,
      mapId: finalMapId,
    });
    setIsCreating(false);
  };

  const isBusy = isCreating;

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

      {/* 对局地图选择：官方下拉 + map ID 输入 */}
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
        <Input
          placeholder="粘贴地图 ID（可选，优先于上方下拉）"
          value={mapIdInput}
          onChange={(e) => handleMapIdChange(e.target.value)}
          onBlur={handleMapIdBlur}
          disabled={isBusy}
          className="bg-slate-900/50 border-sky-500/20 text-white placeholder:text-slate-600 font-mono text-xs"
        />
        {mapIdPreview && (
          <div className="text-xs text-emerald-400">
            ✓ {mapIdPreview.name}（{mapIdPreview.nodeCount} 节点）
          </div>
        )}
        {mapIdError && (
          <div className="text-xs text-red-400">✗ {mapIdError}</div>
        )}
        {!mapIdPreview && !mapIdError && (
          <div className="text-xs text-slate-500">
            粘贴地图 ID 后自动预览
          </div>
        )}
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
