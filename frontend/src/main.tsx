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
import NotFound from './pages/NotFound'

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
