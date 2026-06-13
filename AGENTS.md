# AGENTS.md - Repository Knowledge Base

## 1. 概述

语言：中文

本项目是一个**卡牌策略游戏「黑暗森林」**，包含：

- **frontend/** — Vite 8 + React 19 + TypeScript 前端 SPA
- **backend/** — Go 后端服务
- **prisma/** — Prisma 数据库 Schema（SQLite）

### 前端技术栈

- **Vite 8** 构建工具
- **React 19 + TypeScript 6.0**
- **Tailwind CSS v4** 样式
- **Zustand v5** 状态管理
- **React Router DOM v7** 路由
- **Lucide React** 图标
- **原生 WebSocket** 通信（无 Socket.IO）

### 后端技术栈

- **Go** 语言
- **Prisma** ORM（SQLite）

---

## 2. 构建/开发/检查命令

### 2.1 开发服务器

```bash
# 启动 Vite 开发服务器
cd frontend && pnpm dev
# or
cd frontend && bun run dev
```

### 2.2 构建

```bash
cd frontend && pnpm build
# or
cd frontend && bun run build
```

### 2.3 代码检查

```bash
cd frontend && pnpm lint
# or
cd frontend && bun run lint
```

### 2.4 环境变量

Frontend（`frontend/.env`）：
```env
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
```

---

## 3. 前端项目结构

```
frontend/
├── index.html              # HTML 入口
├── vite.config.ts          # Vite 配置（含 API/WS 代理）
├── tsconfig.app.json       # TypeScript 应用配置
├── tsconfig.node.json      # TypeScript Node 配置
├── eslint.config.js        # ESLint 扁平配置
├── postcss.config.js       # PostCSS 配置
├── src/
│   ├── main.tsx            # 入口文件（路由 + 渲染）
│   ├── index.css           # Tailwind 全局样式
│   ├── layouts/
│   │   └── RootLayout.tsx  # 根布局
│   ├── pages/              # 页面组件
│   │   ├── Home.tsx        # 首页/匹配/游戏
│   │   ├── Auth.tsx        # 登录/注册
│   │   ├── Admin.tsx       # 管理面板
│   │   ├── AdminSetup.tsx  # 管理员初始化
│   │   └── Replay.tsx      # 回放
│   ├── api/                # HTTP API 封装
│   │   ├── http.ts         # 通用 HTTP 客户端
│   │   ├── auth.ts         # 认证相关 API
│   │   ├── health.ts       # 健康检查 API
│   │   └── replay.ts       # 回放相关 API
│   ├── ws/                 # WebSocket 通信
│   │   ├── client.ts       # WebSocket 客户端
│   │   └── protocol.ts     # 协议类型定义
│   ├── store/
│   │   └── authStore.ts    # Zustand 认证状态
│   └── hooks/
│       └── useWebSocket.ts # WebSocket React Hook
```

---

## 4. 导入规范

### 路径别名

使用 `@` 别名（指向 `src/`）：

```typescript
import { wsClient } from '@/ws/client';
import { useAuthStore } from '@/store/authStore';
```

### 相对导入

```typescript
import { getToken } from '../store/authStore';
import type { Message } from './protocol';
```

---

## 5. TypeScript 规范

### 接口定义

```typescript
interface Player {
  id: string;
  displayName: string;
  role: string;
}
```

### 类型别名

```typescript
type GameMode = 'menu' | 'matchmaking' | 'online';
type ClientEvent = 'player:login' | 'match:joinQueue' | ...;
```

### 命名规范

- 变量/函数：`camelCase`
- 文件：`kebab-case`
- 组件：`PascalCase`
- 常量：`UPPER_SNAKE_CASE`

---

## 6. 编码规范

### 异步操作

始终使用 try-catch：

```typescript
try {
  const response = await login(data);
  authLogin(response.token, response.player);
} catch (err) {
  setError(err instanceof Error ? err.message : '登录失败');
}
```

### 错误处理

- 使用 `{ success: boolean; error?: string }` 模式（与 Go 后端一致）
- 预期错误返回对象，不 throw
- `console.error` 仅用于调试

### WebSocket 使用

```typescript
// 连接
wsClient.connect();

// 发送事件
send('match:joinQueue', { preferredCount: 4 });

// 监听事件
const unsub = on('match:found', (payload) => { ... });
```

### 状态管理（Zustand）

```typescript
const useStore = create<Store>()(
  persist(
    (set) => ({
      // state + actions
    }),
    { name: 'storage-key' }
  )
);
```

---

## 7. 提交规范

- 使用中文描述改动
- 格式：`<type>: <description>`
- type: `fix` / `feat` / `refactor` / `docs` / `chore`

---

## 8. 常见问题

### WebSocket 连接失败

- 确认 Go 后端已启动
- 检查 `VITE_WS_URL` 配置
- Vite 开发模式下 `/ws` 被代理到 `localhost:8080`

### 构建失败

```bash
# 确保依赖安装
cd frontend && pnpm install

# 清理缓存
cd frontend && pnpm run build --force
```

### Tailwind 样式不生效

- 确认 `src/main.tsx` 中有 `import './index.css'`
- 确认 Tailwind v4 使用 `@import "tailwindcss"` 而非 `@tailwind`

---

## 9. 部署

```bash
# 构建前端
cd frontend && pnpm build

# 产物在 frontend/dist/
# 由 Go 后端作为静态资源服务
```
