import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ReplayList } from '../components/online/ReplayList';
import { ReplayPlayer } from '../components/online/ReplayPlayer';

export default function Replay() {
  const navigate = useNavigate();
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);

  const handleSelectReplay = (replayId: string) => {
    setSelectedReplayId(replayId);
  };

  const handleBack = () => {
    setSelectedReplayId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
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

        {selectedReplayId ? (
          <ReplayPlayer replayId={selectedReplayId} onClose={handleBack} />
        ) : (
          <ReplayList onSelectReplay={handleSelectReplay} />
        )}
      </div>
    </div>
  );
}
