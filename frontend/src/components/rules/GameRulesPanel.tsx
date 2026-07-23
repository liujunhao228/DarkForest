import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Sparkles, Crosshair, Factory, Trophy, BookOpen, GitCompare, Map as MapIcon, Crown } from 'lucide-react';
import type { GameMode } from '@/lib/game/types';
import type { ModeRules } from '@/lib/game/modeRules';
import {
  getAllRules,
  getRoomRules,
  getRoomRuleDescription,
  formatConfigValue,
  renderRuleCellValue,
  type AllRulesResponse,
  type RoomRulesResponse,
  type RuleConfig,
  type RuleConfigValue,
  type RuleConfigCategory,
} from '@/api/rules';
import { CATEGORY_LABELS, MODE_LABELS, RULES_PANEL_TITLE, RULES_TIP } from '@/constants/rulesText';
import { CardDefinitionGrid } from './CardDefinitionGrid';
import { ModeRulesCompare } from './ModeRulesCompare';
import { MechanismExplain } from './MechanismExplain';
import { StarMapPreview } from './StarMapPreview';
import { RelicComboList } from './RelicComboList';

// ============================================================================
// 常量
// ============================================================================

type Variant = 'full' | 'mode-filtered' | 'compact';

const CATEGORY_ORDER: RuleConfigCategory[] = ['lightspeed', 'relic', 'strike'];

/**
 * config key → ModeRules 字段映射（与后端 rules_export.go computeRuleValues 对齐）。
 * random_cost / specified_cost 在两模式映射到不同 ModeRules 字段，故用 Record<GameMode, field> 形式。
 */
const CONFIG_KEY_TO_MODE_RULES_FIELD: Record<string, keyof ModeRules | Record<GameMode, keyof ModeRules>> = {
  'lightspeed.usage': 'lightspeedUsage',
  'lightspeed.deploy_cost': 'lightspeedDeployCost',
  'lightspeed.random_cost': { classic: 'lightspeedCombinedActionCost', civilization_relics: 'lightspeedJumpCost' },
  'lightspeed.carry_cap': 'lightspeedCarryCap',
  'lightspeed.message_enabled': 'lightspeedMessageEnabled',
  'relic.distribution_enabled': 'relicDistributionEnabled',
  'strike.origin': 'strikeOrigin',
  'strike.miss_behavior': 'strikeMissBehavior',
  'strike.can_destroy_relic': 'strikeCanDestroyRelic',
};

/**
 * 解析规则配置项在指定模式下的有效值。
 * 当 modeRules 提供时（自定义房间），优先返回 modeRules 中对应字段的值；
 * 否则回退到 cfg.values[mode] 预设值。
 */
function resolveEffectiveValue(cfg: RuleConfig, mode: GameMode, modeRules?: ModeRules | null): RuleConfigValue | undefined {
  if (modeRules) {
    const mapping = CONFIG_KEY_TO_MODE_RULES_FIELD[cfg.key];
    if (mapping) {
      const field = typeof mapping === 'string' ? mapping : mapping[mode];
      const v = modeRules[field];
      if (v !== undefined) return v as RuleConfigValue;
    }
  }
  return cfg.values[mode];
}

// ============================================================================
// Props
// ============================================================================

export interface GameRulesPanelProps {
  variant: Variant;
  /** mode-filtered 需要 */
  roomId?: string;
  /** compact / mode-filtered 都需要（mode-filtered 优先用 API 返回的 gameMode） */
  gameMode?: GameMode;
  /** compact 视图的自定义规则覆盖；提供时展示覆盖后的有效值 */
  modeRules?: ModeRules | null;
  /** 默认打开的标签页 */
  defaultTab?: string;
  /** 控制显示/隐藏 */
  visible?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

// ============================================================================
// 数据加载 Hook
// ============================================================================

type LoadState =
  | { status: 'loading' }
  | { status: 'success'; data: AllRulesResponse }
  | { status: 'error'; error: string };

function useRulesData(variant: Variant, roomId?: string, enabled?: boolean): { state: LoadState; reload: () => void } {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // 标记本次加载为 loading 状态，属于合法的 effect 状态同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ status: 'loading' });

    const load = async () => {
      try {
        if (variant === 'mode-filtered' && roomId) {
          const data = await getRoomRules(roomId);
          if (!cancelled) {
            setState({ status: 'success', data });
          }
        } else {
          const data = await getAllRules();
          if (!cancelled) {
            setState({ status: 'success', data });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误';
        console.error('[GameRulesPanel] 加载规则数据失败:', message);
        if (!cancelled) {
          setState({ status: 'error', error: message });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [variant, roomId, enabled, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  return { state, reload };
}

// ============================================================================
// 当前房间规则摘要（mode-filtered 用）
// ============================================================================

interface RoomRuleSummaryProps {
  data: RoomRulesResponse;
}

function RoomRuleSummary({ data }: RoomRuleSummaryProps) {
  const grouped = useMemo(() => {
    const map = new Map<RuleConfigCategory, RuleConfig[]>();
    for (const cfg of data.ruleConfigs) {
      const list = map.get(cfg.category) ?? [];
      list.push(cfg);
      map.set(cfg.category, list);
    }
    return CATEGORY_ORDER.map((cat) => ({ category: cat, configs: map.get(cat) ?? [] })).filter((g) => g.configs.length > 0);
  }, [data.ruleConfigs]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 flex items-center gap-3">
        <div>
          <div className="text-xs text-slate-400">当前房间游戏模式</div>
          <div className="text-lg font-semibold text-cyan-300">{MODE_LABELS[data.gameMode] ?? data.gameMode}</div>
        </div>
        {data.roomId && (
          <Badge variant="outline" className="ml-auto text-[10px] border-slate-700 text-slate-400 font-mono">
            {data.roomId.slice(0, 8)}
          </Badge>
        )}
      </div>

      {grouped.map((group) => (
        <div key={group.category} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <span className="inline-block w-1 h-4 rounded bg-cyan-500" />
            {CATEGORY_LABELS[group.category]}
          </h3>
          <div className="space-y-2">
            {group.configs.map((cfg) => {
              const desc = getRoomRuleDescription(cfg);
              const valueDisplay = cfg.activeValue !== undefined
                ? renderRuleCellValue(cfg, cfg.activeValue as RuleConfigValue)
                : '—';
              return (
                <div key={cfg.key} className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200">{cfg.name}</div>
                      <p className="text-xs leading-relaxed text-slate-400 mt-1">{desc}</p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs text-slate-500">当前取值</div>
                      <div className="text-sm font-semibold text-cyan-300">{valueDisplay}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Compact 视图
// ============================================================================

interface CompactViewProps {
  data: AllRulesResponse;
  gameMode?: GameMode;
  /** 自定义房间规则覆盖；提供时 compact 视图展示覆盖后的有效值 */
  modeRules?: ModeRules | null;
}

function CompactView({ data, gameMode, modeRules }: CompactViewProps) {
  const activeMode: GameMode = gameMode ?? 'classic';
  const modeLabel = MODE_LABELS[activeMode];

  // 当前模式下的规则配置项摘要（自定义覆盖优先于预设）
  const activeConfigs = useMemo(() => {
    return data.ruleConfigs
      .map((cfg): { cfg: RuleConfig; value: RuleConfigValue; desc: string } | null => {
        const value = resolveEffectiveValue(cfg, activeMode, modeRules);
        if (value === undefined) return null;
        const key = `${activeMode}.${formatConfigValue(value)}`;
        const desc = cfg.descriptions[key] ?? '';
        return { cfg, value, desc };
      })
      .filter((x): x is { cfg: RuleConfig; value: RuleConfigValue; desc: string } => x !== null);
  }, [data.ruleConfigs, activeMode, modeRules]);

  return (
    <div className="space-y-4">
      {/* 当前模式提示 */}
      <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2 text-center">
        <div className="text-xs text-slate-400">当前对局模式</div>
        <div className="text-base font-semibold text-cyan-300">{modeLabel}</div>
      </div>

      {/* 当前模式规则摘要 */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 当前模式规则
        </h3>
        <div className="space-y-1.5">
          {activeConfigs.map(({ cfg, value, desc }) => (
            <div key={cfg.key} className="rounded-md border border-slate-800 bg-slate-900/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-200 truncate">{cfg.name}</span>
                <span className="text-[10px] text-cyan-300 flex-shrink-0">
                  {renderRuleCellValue(cfg, value)}
                </span>
              </div>
              {desc && (
                <p className="text-[10px] text-slate-500 mt-1 leading-snug">{desc}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 卡牌速查 */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <BookOpen className="w-3 h-3" /> 卡牌速查
        </h3>
        <CardDefinitionGrid cards={data.cardDefinitions} groupBy="type" compact />
      </div>
    </div>
  );
}

// ============================================================================
// 主面板
// ============================================================================

export function GameRulesPanel({
  variant,
  roomId,
  gameMode,
  modeRules,
  defaultTab,
  visible = false,
  onClose,
}: GameRulesPanelProps) {
  const { state: loadState, reload } = useRulesData(variant, roomId, visible);
  const [activeTab, setActiveTab] = useState(defaultTab ?? 'cards');

  // 切换 variant 时重置 tab
  useEffect(() => {
    // 属于合法的 effect 状态同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveTab(defaultTab ?? 'cards');
  }, [variant, defaultTab]);

  const data = loadState.status === 'success' ? loadState.data : null;
  const errorMsg = loadState.status === 'error' ? loadState.error : null;
  const isRoom = variant === 'mode-filtered' && data && 'roomId' in data && data.roomId;
  const effectiveGameMode: GameMode = isRoom
    ? (data as RoomRulesResponse).gameMode
    : (gameMode ?? 'classic');

  // 是否展示遗迹图鉴 tab（自定义规则覆盖 relicDistributionEnabled 时也展示）
  const showRelicTab = variant === 'full' || effectiveGameMode === 'civilization_relics' || !!modeRules?.relicDistributionEnabled;

  const dialogMaxWidth = variant === 'compact' ? 'sm:max-w-md' : 'sm:max-w-4xl';

  return (
    <Dialog open={visible} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent
        showCloseButton
        className={`${dialogMaxWidth} max-h-[88vh] p-0 gap-0 bg-slate-950 border-slate-800 text-slate-100 flex flex-col overflow-hidden`}
      >
        <DialogHeader className="px-4 py-3 border-b border-slate-800 space-y-0">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400" />
            {variant === 'full' && RULES_PANEL_TITLE.full}
            {variant === 'mode-filtered' && RULES_PANEL_TITLE['mode-filtered']}
            {variant === 'compact' && RULES_PANEL_TITLE.compact}
          </DialogTitle>
          <DialogDescription className="sr-only">游戏规则展示面板</DialogDescription>
        </DialogHeader>

        {loadState.status === 'loading' ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="text-center space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400 mx-auto" />
              <p className="text-xs text-slate-500">加载规则数据...</p>
            </div>
          </div>
        ) : loadState.status === 'error' ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <div className="text-center space-y-3 px-6">
              <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto" />
              <p className="text-xs text-slate-400">规则数据加载失败</p>
              {errorMsg && <p className="text-[10px] text-slate-500 break-all">{errorMsg}</p>}
              <Button variant="outline" size="sm" onClick={reload} className="border-slate-700 text-slate-300 hover:bg-slate-800">
                重试
              </Button>
            </div>
          </div>
        ) : variant === 'compact' ? (
          <ScrollArea className="flex-1 max-h-[70vh]">
            <div className="p-4">
              <CompactView data={loadState.data} gameMode={effectiveGameMode} modeRules={modeRules} />
            </div>
          </ScrollArea>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <div className="px-3 pt-3 flex-shrink-0">
              <TabsList className="bg-slate-900/60">
                <TabsTrigger value="cards" className="gap-1 text-xs">
                  <BookOpen className="w-3.5 h-3.5" /> 卡牌一览
                </TabsTrigger>
                <TabsTrigger value="modes" className="gap-1 text-xs">
                  <GitCompare className="w-3.5 h-3.5" />
                  {variant === 'mode-filtered' ? '当前规则' : '模式对比'}
                </TabsTrigger>
                <TabsTrigger value="mechanisms" className="gap-1 text-xs">
                  <Crosshair className="w-3.5 h-3.5" /> 游戏机制
                </TabsTrigger>
                <TabsTrigger value="starmap" className="gap-1 text-xs">
                  <MapIcon className="w-3.5 h-3.5" /> 星图预览
                </TabsTrigger>
                {showRelicTab && (
                  <TabsTrigger value="relics" className="gap-1 text-xs">
                    <Crown className="w-3.5 h-3.5" /> 遗迹图鉴
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <ScrollArea className="flex-1 max-h-[70vh]">
              <div className="p-4">
                <TabsContent value="cards" className="mt-0">
                  <div className="mb-3">
                    <div className="text-xs text-slate-400">
                      共 {loadState.data.cardDefinitions.length} 种卡牌定义，按类型分组（{Object.entries(
                        loadState.data.cardDefinitions.reduce<Record<string, number>>((acc, c) => {
                          acc[c.type] = (acc[c.type] ?? 0) + 1;
                          return acc;
                        }, {}),
                      ).map(([t, n]) => `${t} ${n}`).join(' / ')}）
                    </div>
                  </div>
                  <CardDefinitionGrid cards={loadState.data.cardDefinitions} groupBy="type" />
                </TabsContent>

                <TabsContent value="modes" className="mt-0">
                  {variant === 'mode-filtered' && isRoom ? (
                    <RoomRuleSummary data={data as RoomRulesResponse} />
                  ) : (
                    <ModeRulesCompare
                      ruleConfigs={loadState.data.ruleConfigs}
                      activeGameMode={effectiveGameMode}
                    />
                  )}
                </TabsContent>

                <TabsContent value="mechanisms" className="mt-0 space-y-4">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                    <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
                      <Factory className="w-4 h-4 text-emerald-400" /> 游戏基础常量
                    </h3>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      {loadState.data.gameConstants.map((c) => (
                        <div key={c.key} className="text-xs">
                          <div className="text-slate-400">{c.name}</div>
                          <div className="text-slate-100 font-mono font-medium">
                            {c.value}{c.unit && <span className="text-slate-500 ml-0.5">{c.unit}</span>}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{c.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <MechanismExplain mechanisms={loadState.data.mechanisms} />
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
                    <Trophy className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" />
                    <p className="text-xs leading-relaxed text-slate-300">
                      <span className="font-semibold text-amber-300">{RULES_TIP.prefix}</span>
                      {RULES_TIP.detailPre}<a href={RULES_TIP.detailUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{RULES_TIP.detailLink}</a>{RULES_TIP.detailPost}
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="starmap" className="mt-0">
                  <StarMapPreview starMap={loadState.data.starMap} />
                </TabsContent>

                {showRelicTab && (
                  <TabsContent value="relics" className="mt-0">
                    <RelicComboList
                      relicCombos={effectiveGameMode === 'civilization_relics' || variant === 'full'
                        ? loadState.data.relicCombos
                        : []}
                    />
                  </TabsContent>
                )}
              </div>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
