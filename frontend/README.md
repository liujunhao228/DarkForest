# DarkForest Frontend

基于 React + TypeScript + Vite 构建的前端应用，为 DarkForest 游戏提供用户界面。

## 快速开始

### 环境要求

- Node.js 18+ 或 Bun 1.0+
- pnpm（推荐）或 npm

### 安装

```bash
# 安装依赖
pnpm install
# 或
bun install
```

### 配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置必要的环境变量
```

### 运行

```bash
# 开发模式
pnpm dev
# 或
bun run dev
```

应用将在 `http://localhost:5173` 启动。

### 构建

```bash
pnpm build
# 或
bun run build
```

### 测试

```bash
# 运行 lint 检查
pnpm lint
# 或
bun run lint
```

## 项目结构

```
frontend/
├── public/            # 静态资源
├── src/
│   ├── api/          # API 请求封装
│   ├── assets/       # 图片、字体等资源
│   ├── components/   # React 组件
│   ├── hooks/        # 自定义 Hooks
│   ├── lib/          # 工具函数
│   ├── App.tsx       # 应用入口
│   └── main.tsx      # 渲染入口
├── eslint.config.js  # ESLint 配置
├── tsconfig.json     # TypeScript 配置
├── vite.config.ts    # Vite 配置
└── package.json
```

## 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| VITE_API_URL | 后端 API 地址 | http://localhost:8080 |

## 代码规范

### ESLint 配置

项目使用 ESLint 进行代码检查。配置文件位于 `eslint.config.js`。

#### 运行 ESLint

```bash
# 检查所有文件
pnpm lint

# 自动修复问题
pnpm lint --fix
```

#### ESLint 规则

项目启用了以下规则集：

- `@eslint/js` - JavaScript 基础规则
- `typescript-eslint` - TypeScript 严格规则
- `eslint-plugin-react-hooks` - React Hooks 规则
- `eslint-plugin-react-refresh` - React Refresh 规则

#### 扩展配置

如需添加更多规则，可在 `eslint.config.js` 中扩展：

```js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  {
    extends: [
      // 启用 React 相关规则
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
    ],
  },
])
```

### Prettier 配置

项目推荐使用 Prettier 进行代码格式化。

#### 安装 Prettier

```bash
pnpm add -D prettier
```

#### 配置文件

创建 `.prettierrc` 文件：

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

#### 运行 Prettier

```bash
# 格式化所有文件
pnpm exec prettier --write "src/**/*.{ts,tsx,css}"

# 检查格式
pnpm exec prettier --check "src/**/*.{ts,tsx,css}"
```

### 命名约定

#### 变量命名

- 使用 `camelCase` 命名变量和函数
- 使用 `UPPER_SNAKE_CASE` 命名常量
- 使用有意义的名称，避免缩写

```typescript
// ✅ 正确
const playerCount = 4
const isLoading = true
const MAX_PLAYERS = 5

// ❌ 错误
const pc = 4           // 过度缩写
const flag = true      // 不明确
const max_players = 5  // 混合风格
```

#### 函数命名

- 使用 `camelCase` 命名函数
- 函数名应以动词开头，描述行为
- 布尔返回函数使用 `is`, `has`, `can` 等前缀

```typescript
// ✅ 正确
function getPlayerInfo(id: string): Player { ... }
function joinMatchmaking(playerId: string): void { ... }
function isValidMove(move: Move): boolean { ... }

// ❌ 错误
function playerInfo(id: string) { ... }  // 缺少动词
function validate(move: Move) { ... }    // 不明确
```

#### 文件命名

- 组件文件使用 `PascalCase.tsx`
- 工具文件使用 `camelCase.ts`
- 测试文件使用 `xxx.test.ts`

```
// ✅ 正确
PlayerPanel.tsx       // 组件
useSocket.ts          // Hook
matchmaking.test.ts   // 测试

// ❌ 错误
player-panel.tsx      // 不符合 React 规范
UseSocket.ts          // Hook 应使用小写开头
```

#### 类型命名

- 接口使用 `PascalCase`
- 类型别名使用 `PascalCase`
- 使用明确的类型名称

```typescript
// ✅ 正确
interface Player {
  id: string
  name: string
}

type PlayerId = string
type MatchResult = Success | Failure

// ❌ 错误
interface player { ... }  // 应使用 PascalCase
type playerId = string    // 应使用 PascalCase
```

### React 组件约定

#### 组件结构

```typescript
// ✅ 正确：函数组件 + TypeScript
interface PlayerPanelProps {
  playerId: string
  isReady: boolean
}

export function PlayerPanel({ playerId, isReady }: PlayerPanelProps) {
  // Hooks 在顶部
  const player = usePlayer(playerId)
  const [expanded, setExpanded] = useState(false)

  // 事件处理函数
  const handleClick = () => {
    setExpanded(!expanded)
  }

  // 渲染逻辑
  return (
    <div className="player-panel">
      {/* ... */}
    </div>
  )
}
```

#### 组件命名

- 组件名使用 `PascalCase`
- 组件文件名与组件名一致

```typescript
// ✅ 正确
// 文件: PlayerPanel.tsx
export function PlayerPanel() { ... }

// ❌ 错误
// 文件: playerPanel.tsx
export function playerPanel() { ... }
```

#### Props 定义

- 使用接口定义 Props
- 为 Props 添加类型注释

```typescript
// ✅ 正确
interface ButtonProps {
  text: string
  onClick: () => void
  disabled?: boolean  // 可选属性
}

export function Button({ text, onClick, disabled = false }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}>
      {text}
    </button>
  )
}

// ❌ 错误
export function Button(props: any) { ... }  // 使用 any
```

#### Hooks 使用

- Hooks 必须在组件顶层调用
- 自定义 Hook 使用 `use` 前缀

```typescript
// ✅ 正确
function usePlayer(id: string) {
  const [player, setPlayer] = useState<Player | null>(null)
  
  useEffect(() => {
    fetchPlayer(id).then(setPlayer)
  }, [id])
  
  return player
}

// ❌ 错误
function getPlayer(id: string) { ... }  // Hook 应使用 use 前缀
```

#### 事件处理

- 使用箭头函数定义事件处理
- 事件处理函数命名使用 `handle` 前缀

```typescript
// ✅ 正确
const handleClick = () => {
  console.log('clicked')
}

const handleSubmit = (event: React.FormEvent) => {
  event.preventDefault()
}

// ❌ 错误
function click() { ... }       // 缺少 handle 前缀
const onClick = () => { ... }  // 与事件名冲突
```

### 导入约定

#### 导入顺序

1. React 相关导入
2. 第三方库导入
3. 项目内部导入
4. 相对路径导入

```typescript
// ✅ 正确
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { usePlayer } from '@/hooks/usePlayer'

import { helper } from './utils'
```

#### 使用别名导入

```typescript
// ✅ 正确：使用 @ 别名
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

// ❌ 错误：过深的相对路径
import { Button } from '../../../components/ui/button'
```

### TypeScript 最佳实践

#### 避免使用 any

```typescript
// ✅ 正确
function process(data: unknown) {
  if (typeof data === 'string') {
    return data.toUpperCase()
  }
  throw new Error('Invalid data type')
}

// ❌ 错误
function process(data: any) {
  return data.toUpperCase()  // 不安全
}
```

#### 使用类型推断

```typescript
// ✅ 正确：让 TypeScript 推断
const players = ['Alice', 'Bob', 'Charlie']  // string[]

// ❌ 错误：不必要的类型注释
const players: string[] = ['Alice', 'Bob', 'Charlie']
```

#### 使用可选属性

```typescript
// ✅ 正确
interface Config {
  apiUrl: string      // 必需
  timeout?: number    // 可选
}

// 使用时提供默认值
const config: Config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,  // 可选
}
```

### 测试规范

#### 测试文件位置

- 单元测试：`src/__tests__/xxx.test.ts`
- 组件测试：`src/components/__tests__/xxx.test.tsx`

#### 测试命名

```typescript
// ✅ 正确
describe('PlayerPanel', () => {
  it('should render player name', () => { ... })
  it('should handle click event', () => { ... })
})

// ❌ 错误
describe('test1', () => {
  it('test', () => { ... })
})
```

## License

MIT