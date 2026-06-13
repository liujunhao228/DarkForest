import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import './index.css'
import RootLayout from './layouts/RootLayout'
import Home from './pages/Home'
import Auth from './pages/Auth'
import AdminSetup from './pages/AdminSetup'
import Replay from './pages/Replay'
import Admin from './pages/Admin'

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <p className="text-muted-foreground mb-6">页面未找到</p>
        <a href="/" className="text-primary hover:underline">返回首页</a>
      </div>
    </div>
  );
}

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)