import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { login, register, type LoginRequest, type RegisterRequest } from '../api/auth';
import { Orbit, UserPlus, LogIn, AlertCircle, Eye, User } from 'lucide-react';
import { isTrustMode, getTrustIdentity, setTrustIdentity } from '../lib/trust';

type TabType = 'login' | 'register';

export default function Auth() {
  const navigate = useNavigate();
  const authLogin = useAuthStore((s) => s.login);
  const [activeTab, setActiveTab] = useState<TabType>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  // trust 模式：免 JWT，改为本地身份启动器
  if (isTrustMode()) {
    return <TrustLauncher />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data: LoginRequest = { displayName: loginName, password: loginPassword };
      const response = await login(data);
      
      authLogin(response.token, response.player);
      
      if (response.player.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data: RegisterRequest = {
        displayName: regName,
        password: regPassword,
        inviteCode: inviteCode.toUpperCase(),
      };
      const response = await register(data);
      
      authLogin(response.token, response.player);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-xl p-6 max-md:p-4">
        <div className="text-center mb-6">
          <div className="relative mb-2">
            <div className="absolute inset-0 bg-purple-500/10 blur-2xl rounded-full" />
            <Orbit className="w-12 h-12 mx-auto text-purple-400 relative" />
          </div>
          <h1 className="text-2xl bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent font-bold">
            黑暗森林
          </h1>
          <p className="text-slate-400 mt-2">登录或注册账号以继续游戏</p>
        </div>

        <div className="flex bg-slate-800 rounded-lg p-1 mb-6">
          <button
            type="button"
            onClick={() => setActiveTab('login')}
            className={`flex-1 flex items-center justify-center py-2 rounded-md transition-all ${
              activeTab === 'login'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LogIn className="w-4 h-4 mr-2" />
            登录
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('register')}
            className={`flex-1 flex items-center justify-center py-2 rounded-md transition-all ${
              activeTab === 'register'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            注册
          </button>
        </div>

        {activeTab === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="flex items-center text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 mr-2" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-slate-300 text-sm mb-2">显示名称</label>
              <input
                type="text"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                placeholder="你的名称"
                required
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 text-sm mb-2">密码</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="你的密码"
                required
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 rounded-lg text-white font-semibold transition-all disabled:opacity-50"
            >
              {loading ? '登录中...' : '进入黑暗森林'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="flex items-center text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 mr-2" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-slate-300 text-sm mb-2">显示名称</label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="你的名称"
                required
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 text-sm mb-2">密码</label>
              <input
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="至少 6 位"
                required
                minLength={6}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 text-sm mb-2">邀请码</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="6 位邀请码"
                required
                maxLength={6}
                className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500 uppercase tracking-widest"
              />
              <p className="text-xs text-slate-500 mt-1">请联系房主获取邀请码</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 rounded-lg text-white font-semibold transition-all disabled:opacity-50"
            >
              {loading ? '注册中...' : '进入黑暗森林'}
            </button>
          </form>
        )}

        <p className="text-center text-slate-500 text-sm mt-6">
          首次部署？{' '}
          <button
            onClick={() => navigate('/auth/admin-setup')}
            className="text-purple-400 hover:text-purple-300 underline"
          >
            创建管理员账号
          </button>
        </p>
      </div>
    </div>
  );
}

// TrustLauncher 本地信任模式的身份启动器：录入本地玩家 id + 昵称，
// 或进入"观看 Agent"视角。免 JWT。
function TrustLauncher() {
  const navigate = useNavigate();
  const existing = getTrustIdentity();
  const [qq, setQq] = useState(existing?.qq ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [error, setError] = useState('');

  const handleEnter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qq.trim()) {
      setError('请输入本地玩家 id（纯数字）');
      return;
    }
    if (!/^\d+$/.test(qq.trim())) {
      setError('本地玩家 id 必须为纯数字');
      return;
    }
    if (!name.trim()) {
      setError('请输入昵称');
      return;
    }
    setTrustIdentity({ qq: qq.trim(), name: name.trim() });
    // 整页重载而非 SPA 导航：wsClient 单例在模块加载时按身份拼 URL，
    // 首次设置身份后必须重载才能让 WS 带上正确的 ?qq=&name=。
    window.location.assign('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-xl p-6 max-md:p-4">
        <div className="text-center mb-6">
          <div className="relative mb-2">
            <div className="absolute inset-0 bg-purple-500/10 blur-2xl rounded-full" />
            <User className="w-12 h-12 mx-auto text-purple-400 relative" />
          </div>
          <h1 className="text-2xl bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent font-bold">
            黑暗森林 · 本地模式
          </h1>
          <p className="text-slate-400 mt-2">以本地玩家身份进入对局</p>
        </div>

        <form onSubmit={handleEnter} className="space-y-4">
          {error && (
            <div className="flex items-center text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 mr-2" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-slate-300 text-sm mb-2">本地玩家 id（纯数字）</label>
            <input
              type="text"
              value={qq}
              onChange={(e) => setQq(e.target.value)}
              placeholder="如 10001"
              required
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm mb-2">昵称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="你的名称"
              required
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 rounded-lg text-white font-semibold transition-all"
          >
            进入黑暗森林
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate('/watch')}
          className="mt-3 w-full flex items-center justify-center py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 font-semibold transition-all"
        >
          <Eye className="w-4 h-4 mr-2" />
          观看 Agent 对局
        </button>
      </div>
    </div>
  );
}