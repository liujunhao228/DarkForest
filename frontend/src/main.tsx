import { StrictMode, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import './index.css'
import RootLayout from './layouts/RootLayout'
import Home from './pages/Home'
import { fetchSensitiveWords } from './api/sensitiveWords'

// 非首屏页面懒加载，避免进入首屏 bundle
const Auth = lazy(() => import('./pages/Auth'))
const AdminSetup = lazy(() => import('./pages/AdminSetup'))
const Replay = lazy(() => import('./pages/Replay'))
const Admin = lazy(() => import('./pages/Admin'))
const NotFound = lazy(() => import('./pages/NotFound'))

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
