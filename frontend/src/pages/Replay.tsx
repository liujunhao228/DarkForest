import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ReplayList } from '../components/online/ReplayList';
import { ReplayPlayer } from '../components/online/ReplayPlayer';

export default function Replay() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const urlReplayId = params.id ?? null;

  // selectedReplayId 由 URL 驱动
  const selectedReplayId = urlReplayId;

  const handleSelectReplay = (replayId: string) => {
    navigate(`/replay/${replayId}`);
  };

  const handleBack = () => {
    navigate('/replay');
  };

  useEffect(() => {
    if (!selectedReplayId) {
      window.scrollTo(0, 0);
    }
  }, [selectedReplayId]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950">
      {selectedReplayId ? (
        <div className="h-dvh w-full">
          <ReplayPlayer key={selectedReplayId} replayId={selectedReplayId} onClose={handleBack} />
        </div>
      ) : (
        <div className="p-4">
          <div className="max-w-4xl mx-auto">
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

            <ReplayList onSelectReplay={handleSelectReplay} />
          </div>
        </div>
      )}
    </div>
  );
}
