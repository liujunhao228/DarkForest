import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, RefreshCw, Eye } from 'lucide-react';
import { listAgents, type AgentInfo } from '@/api/agentManager';
import { connectWatch } from '@/ws/watchClient';
import { useWatchStore } from '@/store/watchStore';
import { OnlineStarMap } from '@/components/online/OnlineStarMap';

export default function Watch() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [listError, setListError] = useState('');

  const selectedSid = useWatchStore((s) => s.sid);
  const viewState = useWatchStore((s) => s.viewState);
  const connected = useWatchStore((s) => s.connected);
  const watchError = useWatchStore((s) => s.error);

  const refresh = async () => {
    setLoadingAgents(true);
    setListError('');
    try {
      const list = await listAgents();
      setAgents(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : '获取 Agent 列表失败');
    } finally {
      setLoadingAgents(false);
    }
  };

  // 初始加载（loadingAgents 默认 true，首个状态更新发生在 await 之后，避免同步 setState）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listAgents();
        if (!cancelled) setAgents(list);
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : '获取 Agent 列表失败');
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 管理旁观连接：选中 sid 时建立 /ws?watch=<sid>，卸载或切换时关闭。
  useEffect(() => {
    if (!selectedSid) return;
    const store = useWatchStore.getState();
    store.reset();
    store.setSid(selectedSid);

    const conn = connectWatch(selectedSid, {
      onFullSync: (view) => useWatchStore.getState().setViewState(view),
      onError: (message) => useWatchStore.getState().setError(message),
      onDisconnect: () => useWatchStore.getState().setConnected(false),
    });
    useWatchStore.getState().setConnected(true);

    return () => {
      conn.close();
      useWatchStore.getState().reset();
    };
  }, [selectedSid]);

  const runningAgents = agents.filter((a) => a.status === 'running');

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-slate-200">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-slate-800">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <h1 className="text-lg font-semibold text-slate-100">观看 Agent 对局</h1>
        <button
          onClick={() => void refresh()}
          className="ml-auto flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200"
        >
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </header>

      <div className="flex flex-col lg:flex-row">
        {/* 左侧：Agent 列表 */}
        <aside className="w-full lg:w-72 shrink-0 border-r border-slate-800 p-4 space-y-2">
          <p className="text-xs text-slate-500">选择正在对局的 Agent 以观看其私有视野</p>
          {listError && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4" />
              {listError}
            </div>
          )}
          {!listError && loadingAgents && <p className="text-sm text-slate-500">加载中…</p>}
          {!listError && !loadingAgents && runningAgents.length === 0 && (
            <p className="text-sm text-slate-500">暂无正在对局的 Agent（需 dsh-darkforest-gui 插件已启动并 spawn agent）</p>
          )}
          {runningAgents.map((agent) => (
            <button
              key={agent.sid}
              onClick={() => useWatchStore.getState().setSid(agent.sid)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left text-sm transition-all ${
                selectedSid === agent.sid
                  ? 'bg-purple-600/20 border-purple-500 text-slate-100'
                  : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-2">
                <Eye className="w-4 h-4" />
                {agent.sid}
              </span>
              <span className="text-xs text-slate-500">{agent.status}</span>
            </button>
          ))}
        </aside>

        {/* 右侧：旁观星图 */}
        <main className="flex-1 h-[calc(100vh-4rem)] lg:h-[calc(100vh-4rem)]">
          {!selectedSid && (
            <div className="h-full flex items-center justify-center text-slate-500">
              从左侧选择一个 Agent 开始观看
            </div>
          )}
          {selectedSid && !connected && !viewState && (
            <div className="h-full flex items-center justify-center text-slate-500">
              连接中…
            </div>
          )}
          {selectedSid && watchError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4" />
              {watchError}
            </div>
          )}
          {selectedSid && viewState && (
            <div className="h-full">
              <OnlineStarMap gameState={viewState} interactiveMode={false} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}