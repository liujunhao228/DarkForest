import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { adminSetup, type AdminSetupRequest } from '../api/auth';
import { Shield, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function AdminSetup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authLogin = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);

  const secretFromUrl = searchParams?.get('secret') || '';

  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState(secretFromUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isAuthenticated && token) {
      navigate('/');
    }
  }, [isAuthenticated, token, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data: AdminSetupRequest = { displayName, password, secret };
      const response = await adminSetup(data);
      
      authLogin(response.token, response.player);
      setSuccess(true);

      setTimeout(() => {
        navigate('/admin');
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
        <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-xl p-8 text-center">
          <CheckCircle2 className="w-16 h-16 mx-auto text-green-500 mb-4" />
          <h2 className="text-2xl font-bold text-green-600 mb-2">创建成功</h2>
          <p className="text-slate-400">管理员账号已创建，正在跳转到管理面板...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-xl p-6">
        <div className="text-center mb-6">
          <Shield className="w-12 h-12 mx-auto text-primary mb-2" />
          <h1 className="text-xl font-bold mb-2">创建管理员账号</h1>
          <p className="text-slate-400 text-sm">首次部署时创建管理员账号</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="例如：房主"
              required
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm mb-2">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              required
              minLength={6}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm mb-2">管理员密钥</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="从 .env 文件获取"
              required
              className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              在 <code className="bg-muted px-1 py-0.5 rounded">.env</code> 中的{' '}
              <code className="bg-muted px-1 py-0.5 rounded">ADMIN_SECRET_KEY</code> 查看
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 rounded-lg text-white font-semibold transition-all disabled:opacity-50"
          >
            {loading ? '创建中...' : '创建管理员账号'}
          </button>
        </form>

        <p className="text-center text-slate-500 text-sm mt-6">
          已有账号？{' '}
          <button
            onClick={() => navigate('/auth')}
            className="text-purple-400 hover:text-purple-300 underline"
          >
            返回登录
          </button>
        </p>
      </div>
    </div>
  );
}