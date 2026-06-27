import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createInvite, listInvites, type InvitationInfo } from '../api/auth';
import { get } from '../api/http';
import { ArrowLeft, Users, Gift, LogOut, RefreshCw } from 'lucide-react';

interface Player {
  id: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export default function Admin() {
  const navigate = useNavigate();
  const { isAuthenticated, player, logout } = useAuthStore();
  const [players, setPlayers] = useState<Player[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InvitationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [playersRes, invitesRes] = await Promise.all([
        get<{ success: boolean; players: Player[] }>('/api/player'),
        listInvites(),
      ]);
      setPlayers(playersRes.players || []);
      setInviteCodes(invitesRes.invitations || []);
      setMessage('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth');
      return;
    }

    if (player?.role !== 'admin') {
      navigate('/');
      return;
    }

    const timer = setTimeout(() => loadData(), 0);
    return () => clearTimeout(timer);
  }, [isAuthenticated, player, navigate]);

  const handleGenerateInvite = async () => {
    setGenerating(true);
    try {
      const response = await createInvite();
      if (response.success && response.invitation) {
        setInviteCodes(prev => [response.invitation, ...prev]);
        setMessage('邀请码生成成功！');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              返回首页
            </button>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              管理控制台
            </h1>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-all"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </header>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${message.includes('成功') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-800/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold">玩家列表</h2>
              </div>
              <button
                onClick={loadData}
                className="p-2 text-slate-400 hover:text-white transition-all"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {players.length === 0 ? (
                <p className="text-slate-400 text-center py-4">暂无玩家</p>
              ) : (
                players.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                    <div>
                      <div className="font-medium">{p.displayName}</div>
                      <div className="text-xs text-slate-400">
                        {p.role === 'admin' ? '管理员' : '普通玩家'}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(p.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-cyan-400" />
                <h2 className="text-lg font-semibold">邀请码管理</h2>
              </div>
              <button
                onClick={handleGenerateInvite}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg transition-all disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  '生成邀请码'
                )}
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {inviteCodes.length === 0 ? (
                <p className="text-slate-400 text-center py-4">暂无邀请码</p>
              ) : (
                inviteCodes.map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                    <div className="font-mono text-lg tracking-widest">
                      {invite.code}
                    </div>
                    <div className={`px-2 py-1 text-xs rounded-full ${invite.isUsed ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                      {invite.isUsed ? '已使用' : '未使用'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
