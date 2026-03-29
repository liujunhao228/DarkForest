# 黑暗森林 (Dark Forest) - 项目上下文文档

## 项目概述

**黑暗森林** 是一款基于《三体》黑暗森林理论开发的网络桌游 Web 应用。玩家扮演宇宙中的文明，通过广播、打击、防御和设施建设等策略，在黑暗森林中生存并最终消灭其他文明。

- **项目类型**: Next.js + React + TypeScript 全栈 Web 应用
- **游戏类型**: 多人策略卡牌游戏 (3-5 人)
- **每局时长**: 约 30 分钟
- **运行时**: Bun
- **UI 框架**: shadcn/ui + Tailwind CSS
- **状态管理**: Zustand
- **数据库**: Prisma + SQLite

## 技术栈

### 核心框架
| 类别 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript 5 |
| 运行时 | Bun |
| UI 组件 | shadcn/ui (Radix UI) |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand |
| 数据请求 | TanStack Query |
| 数据库 ORM | Prisma |
| 数据库 | SQLite |
| 动画 | Framer Motion |

### 关键依赖
- `@dnd-kit/*` - 拖拽功能
- `react-hook-form` + `zod` - 表单验证
- `next-auth` - 认证 (预留)
- `next-intl` - 国际化 (预留)
- `next-themes` - 主题切换
- `lucide-react` - 图标库
- `sonner` - Toast 通知

## 项目结构

```
E:\DarkForest/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API 路由
│   │   ├── globals.css         # 全局样式
│   │   ├── layout.tsx          # 根布局
│   │   └── page.tsx            # 主页面
│   ├── components/
│   │   ├── game/               # 游戏核心组件
│   │   │   ├── GameBoard.tsx   # 游戏主界面
│   │   │   ├── GameSetup.tsx   # 游戏设置
│   │   │   ├── GameOver.tsx    # 游戏结束
│   │   │   ├── GameCard.tsx    # 卡牌组件
│   │   │   ├── PlayerHand.tsx  # 玩家手牌
│   │   │   ├── PlayerPanel.tsx # 玩家面板
│   │   │   ├── StarMap.tsx     # 星图组件
│   │   │   ├── BroadcastDialog.tsx
│   │   │   ├── StrikeDialog.tsx
│   │   │   ├── GameLog.tsx     # 游戏日志
│   │   └── ui/                 # shadcn/ui 基础组件
│   ├── hooks/                  # 自定义 Hooks
│   ├── lib/
│   │   ├── game/               # 游戏核心逻辑
│   │   │   ├── types.ts        # TypeScript 类型定义
│   │   │   ├── engine.ts       # 游戏引擎 (回合/卡牌/战斗)
│   │   │   ├── cards.ts        # 卡牌数据定义
│   │   │   └── starmap.ts      # 星图数据
│   │   ├── db.ts               # Prisma 客户端
│   │   └── utils.ts            # 工具函数
│   └── store/
│       └── gameStore.ts        # Zustand 游戏状态
├── prisma/
│   └── schema.prisma           # Prisma Schema
├── db/                         # SQLite 数据库文件
├── public/
│   └── images/                 # 游戏卡牌图片
├── .zscripts/                  # 开发/部署脚本
├── mini-services/              # 微服务目录 (预留)
└── examples/
    └── websocket/              # WebSocket 示例 (预留多人联机)
```

## 游戏核心机制

### 卡牌类型
1. **广播牌 (Broadcast)** - 合作/伪装博弈，获取能量
2. **打击牌 (Strike)** - 攻击其他玩家，具有等级和速度
3. **防御牌 (Defense)** - 抵御打击，有保护等级
4. **设施牌 (Facility)** - 每回合产出能量或特殊能力

### 回合结构
1. **回合开始** - 结算设施产出、打击移动
2. **摸牌阶段** - 摸取 4 张牌
3. **行动阶段** - 选择换牌或打牌

### 胜利条件
- **终极文明**: 唯一幸存玩家获胜
- **永恒黑暗**: 无幸存玩家，平局

## 构建与运行

### 环境要求
- Node.js 18+ 或 Bun 1.0+
- Git

### 安装依赖
```bash
bun install
```

### 开发模式
```bash
# 使用开发脚本 (推荐)
.zscripts/dev.sh

# 或直接运行
bun run dev
```

### 数据库操作
```bash
bun run db:push      # 推送 Schema 到数据库
bun run db:generate  # 生成 Prisma 客户端
bun run db:migrate   # 运行迁移
bun run db:reset     # 重置数据库
```

### 生产构建
```bash
bun run build
bun run start
```

### 代码检查
```bash
bun run lint
```

## 开发约定

### 代码风格
- 使用 TypeScript，严格模式
- 组件使用函数式 + Hooks
- 路径别名 `@/*` 指向 `src/*`
- 遵循 ESLint 配置 (`eslint.config.mjs`)

### 组件规范
- UI 组件放在 `src/components/ui/`
- 业务组件放在 `src/components/game/`
- 使用 shadcn/ui 的 "new-york" 风格

### 状态管理
- 游戏状态使用 Zustand store (`gameStore.ts`)
- 游戏逻辑与 UI 分离，逻辑在 `engine.ts` 中

### 提交规范
- 功能开发：`feat: 描述`
- 修复 Bug：`fix: 描述`
- 重构：`refactor: 描述`

## 重要文件说明

| 文件 | 说明 |
|------|------|
| `游戏规则.md` | 完整的游戏规则设计文档 |
| `worklog.md` | 开发工作日志 |
| `src/lib/game/engine.ts` | 游戏核心引擎逻辑 |
| `src/lib/game/cards.ts` | 70 张卡牌的数据定义 |
| `src/lib/game/starmap.ts` | 9 星系星图数据 |
| `src/store/gameStore.ts` | 游戏状态管理 |
| `.zscripts/dev.sh` | 开发环境启动脚本 |

## 待实现功能

根据 `examples/websocket/` 目录判断，项目预留了以下功能：
- 多人在线联机 (WebSocket)
- 用户认证 (next-auth)
- 国际化 (next-intl)
- 微服务架构 (mini-services)

## 注意事项

1. **数据库路径**: `.env` 中配置 `DATABASE_URL=file:/home/z/my-project/db/custom.db` (Linux 路径，Windows 开发需调整)
2. **独立输出**: Next.js 配置为 `standalone` 模式，用于 Docker 部署
3. **Caddy 反向代理**: 使用 `Caddyfile` 配置端口转发

## 相关技能文件

项目包含 `skills/` 目录用于安装 agent 技能，当前为空。
