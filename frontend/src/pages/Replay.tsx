import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listReplays, getReplay, deleteReplay, type Replay } from '../api/replay';
import { ArrowLeft, Play, Trash2, Users, Calendar, Clock } from 'lucide-react';

function ReplayList({ replays, onSelect, onDelete }: { replays: Replay[]; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  if (replays.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">暂无回放记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {replays.map((replay) => (
        <div
          key={replay.id}
          className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
          onClick={() => onSelect(replay.id)}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="font-medium text-white">
                {replay.players.map(p => p.displayName).join(' vs ')}
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(replay.createdAt).toLocaleDateString('zh-CN')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(replay.createdAt).toLocaleTimeString('zh-CN')}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(replay.id);
              }}
              className="p-2 text-slate-400 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button className="px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg flex items-center gap-2 transition-all">
              <Play className="w-4 h-4" />
              播放
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReplayPlayer({ replay, onBack }: { replay: Replay; onBack: () => void }) {
  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-slate-400 hover:text-white transition-all"
      >
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </button>

      <div className="bg-slate-800/50 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">回放详情</h2>
        
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-slate-400">玩家:</span>
            <span className="font-medium">{replay.players.map(p => p.displayName).join(' vs ')}</span>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-slate-400">创建时间:</span>
            <span>{new Date(replay.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-slate-400">动作数:</span>
            <span>{replay.actions.length}</span>
          </div>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-lg p-6">
        <h3 className="font-semibold mb-4">动作序列</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {replay.actions.map((action, index) => (
            <div key={index} className="p-3 bg-slate-700/50 rounded-lg text-sm">
              <span className="text-purple-400 font-mono">#{index + 1}</span>
              <pre className="mt-1 text-slate-300 font-mono text-xs overflow-x-auto">
                {JSON.stringify(action, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Replay() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [replays, setReplays] = useState<Replay[]>([]);
  const [selectedReplay, setSelectedReplay] = useState<Replay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (params.id) {
      loadReplay(params.id);
    } else {
      loadReplays();
    }
  }, [params.id]);

  const loadReplays = async () => {
    setLoading(true);
    try {
      const response = await listReplays();
      setReplays(response.replays);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadReplay = async (id: string) => {
    setLoading(true);
    try {
      const replay = await getReplay(id);
      setSelectedReplay(replay);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectReplay = (id: string) => {
    navigate(`/replay/${id}`);
  };

  const handleDeleteReplay = async (id: string) => {
    if (!confirm('确定删除该回放？')) return;
    try {
      await deleteReplay(id);
      setReplays(replays.filter(r => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleBack = () => {
    navigate('/replay');
    setSelectedReplay(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-all mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
            游戏回放
          </h1>
          <p className="text-slate-400 mt-2">查看历史对局记录</p>
        </header>

        {selectedReplay ? (
          <ReplayPlayer replay={selectedReplay} onBack={handleBack} />
        ) : (
          <ReplayList replays={replays} onSelect={handleSelectReplay} onDelete={handleDeleteReplay} />
        )}
      </div>
    </div>
  );
}