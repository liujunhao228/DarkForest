import { StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import './index.css'
import RootLayout from './layouts/RootLayout'
import Home from './pages/Home'
import { fetchSensitiveWords } from './api/sensitiveWords'
import { wsClient } from '@/ws/client'
import { useOnlineGameStore } from '@/store/onlineGameStore'

// 非首屏页面懒加载，避免进入首屏 bundle
const Auth = lazy(() => import('./pages/Auth'))
const AdminSetup = lazy(() => import('./pages/AdminSetup'))
const Replay = lazy(() => import('./pages/Replay'))
const Admin = lazy(() => import('./pages/Admin'))
const NotFound = lazy(() => import('./pages/NotFound'))
// 开发专用星图视觉实验室：仅 DEV 注册路由，生产构建被 Vite tree-shake 移除
const DevStarMapLab = import.meta.env.DEV ? lazy(() => import('./pages/DevStarMapLab')) : null

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        path: '/',
        element: <Home />,
      },
      {
        path: '/auth',
        element: <Auth />,
      },
      {
        path: '/auth/admin-setup',
        element: <AdminSetup />,
      },
      {
        path: '/replay',
        element: <Replay />,
      },
      {
        path: '/replay/:id',
        element: <Replay />,
      },
      {
        path: '/admin',
        element: <Admin />,
      },
      // 开发专用：星图视觉实验室（生产构建中 DevStarMapLab 为 null，路由不注册）
      ...(DevStarMapLab
        ? [{ path: '/dev/starmap-lab', element: <DevStarMapLab /> }]
        : []),
      {
        path: '*',
        element: <NotFound />,
      },
    ],
  },
])

// 启动时拉取敏感词表并写入缓存（fire-and-forget，不阻塞渲染）
// 失败时降级为不过滤，仅打印错误日志
fetchSensitiveWords().catch(err => console.error('加载敏感词表失败，前端预览将降级为不过滤', err));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)

// E2E 测试运行时暴露：仅在 VITE_E2E=true 构建时注入
// 生产构建中 import.meta.env.VITE_E2E 被替换为 undefined，Vite tree-shake 移除此块
if (import.meta.env.VITE_E2E === 'true') {
  window.__e2e = { wsClient, gameStore: useOnlineGameStore }
}
