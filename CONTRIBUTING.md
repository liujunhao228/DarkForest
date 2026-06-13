# 贡献指南

感谢您对 DarkForest 项目的关注！我们欢迎所有形式的贡献，包括但不限于：

- 🐛 报告 Bug
- 💡 提出新功能建议
- 📝 改进文档
- 🔧 修复代码问题
- ✨ 添加新功能

## 快速开始

### 1. Fork 仓库

点击 GitHub 页面右上角的 "Fork" 按钮，将仓库 Fork 到您的账户。

### 2. 克隆仓库

```bash
git clone https://github.com/<your-username>/DarkForest.git
cd DarkForest
```

### 3. 安装依赖

```bash
# 安装前端依赖
bun install

# 安装后端依赖（如需修改后端）
cd backend
go mod download
cd ..
```

### 4. 创建分支

```bash
git checkout -b feature/your-feature-name
```

## 分支命名约定

请遵循以下分支命名规范：

| 分支类型 | 命名格式 | 示例 | 说明 |
|---------|---------|------|------|
| **功能开发** | `feature/<name>` | `feature/add-replay-system` | 新功能开发 |
| **Bug 修复** | `fix/<name>` | `fix/matchmaking-timeout` | 修复 Bug |
| **重构** | `refactor/<name>` | `refactor/game-engine` | 代码重构 |
| **文档更新** | `docs/<name>` | `docs/api-reference` | 文档改进 |
| **性能优化** | `perf/<name>` | `perf/websocket-latency` | 性能优化 |
| **测试** | `test/<name>` | `test/matchmaking-e2e` | 测试相关 |
| **构建/工具** | `chore/<name>` | `chore/update-eslint` | 构建工具链 |

### 分支命名最佳实践

- 使用简短、描述性的名称
- 使用小写字母和连字符
- 避免使用特殊字符
- 名称应清晰表达分支目的

```bash
# ✅ 正确
git checkout -b feature/player-ranking
git checkout -b fix/socket-connection-error

# ❌ 错误
git checkout -b feature/PlayerRanking    # 大写字母
git checkout -b fix_socket_error         # 下划线
git checkout -b my-feature               # 不明确
```

## 提交信息格式

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范。

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型 (type)

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: 添加玩家排行榜功能` |
| `fix` | Bug 修复 | `fix: 修复匹配超时问题` |
| `docs` | 文档更新 | `docs: 更新 API 文档` |
| `refactor` | 代码重构 | `refactor: 重构游戏引擎` |
| `perf` | 性能优化 | `perf: 优化 WebSocket 连接` |
| `test` | 测试相关 | `test: 添加匹配系统测试` |
| `chore` | 构建/工具 | `chore: 更新 ESLint 配置` |
| `style` | 代码格式 | `style: 格式化代码` |

### 范围 (scope)

可选，用于指定影响的模块：

```
feat(matchmaking): 添加自动匹配功能
fix(game-engine): 修复回合状态同步问题
docs(api): 更新 REST API 文档
```

### 主题 (subject)

- 使用简短、描述性的文本
- 不超过 50 个字符
- 使用祈使语气（如 "添加" 而非 "添加了")
- 不以句号结尾

### 正文 (body)

可选，用于详细说明：

```
feat(matchmaking): 添加自动匹配功能

实现基于玩家评分的自动匹配系统：
- 支持 3-5 人游戏
- 自动平衡玩家评分
- 添加匹配超时处理
```

### 页脚 (footer)

可选，用于关联 Issue 或说明破坏性变更：

```
feat(matchmaking): 添加自动匹配功能

Closes #123
BREAKING CHANGE: 匹配 API 接口已变更
```

### 提交示例

```bash
# ✅ 正确
git commit -m "feat: 添加玩家排行榜功能"
git commit -m "fix(game-engine): 修复回合状态同步问题"
git commit -m "docs: 更新 CONTRIBUTING 文档"

# ❌ 错误
git commit -m "添加功能"              # 缺少类型
git commit -m "Fixed bug"             # 应使用 fix 类型
git commit -m "feat:添加排行榜功能"   # 缺少空格
```

## Pull Request 流程

### 1. 确保代码质量

在提交 PR 前，请确保：

- ✅ 代码通过所有测试
- ✅ 代码通过 lint 检查
- ✅ 新功能有相应的测试
- ✅ 文档已更新（如需要）

```bash
# 前端检查
cd frontend
pnpm lint
pnpm build

# 后端检查
cd backend
gofmt -w .
go vet ./...
go test ./...
```

### 2. 推送分支

```bash
git push origin feature/your-feature-name
```

### 3. 创建 Pull Request

1. 访问您的 Fork 仓库页面
2. 点击 "Compare & pull request" 按钮
3. 填写 PR 描述（使用 PR 模板）
4. 点击 "Create pull request"

### 4. PR 描述模板

请使用项目提供的 PR 模板（见 `.github/PULL_REQUEST_TEMPLATE.md`），包含：

- **变更描述**：简要说明本次变更的内容
- **变更类型**：标记为 Bug 修复 / 新功能 / 重构 / 文档等
- **相关 Issue**：关联的 Issue 编号
- **测试说明**：如何测试本次变更
- **检查清单**：确认已完成的事项

### 5. 等待审查

- PR 会自动触发 CI 检查
- 代码审查者会审核您的代码
- 根据反馈进行必要的修改

### 6. 合并

- PR 通过审查后会被合并
- 您的分支会被自动清理

## 代码审查要点

审查者会关注以下方面：

### 代码质量

- ✅ 代码是否符合项目规范
- ✅ 是否有明显的 Bug 或逻辑错误
- ✅ 是否有性能问题
- ✅ 是否有安全风险

### 测试覆盖

- ✅ 新功能是否有测试
- ✅ 测试是否覆盖边界情况
- ✅ 测试是否可读且有意义

### 文档完整性

- ✅ API 变更是否有文档更新
- ✅ 新功能是否有使用说明
- ✅ 复杂逻辑是否有注释

### 最佳实践

- ✅ 是否遵循项目架构
- ✅ 是否复用现有代码
- ✅ 是否避免过度设计

## 代码规范

### Go 代码规范

详见 [backend/README.md](backend/README.md) 的代码规范部分。

关键要点：

- 使用 `gofmt` 格式化代码
- 使用 `go vet` 进行静态分析
- 错误包装使用 `%w` 格式
- 错误变量命名使用 `ErrXxx`

### TypeScript 代码规范

详见 [frontend/README.md](frontend/README.md) 的代码规范部分。

关键要点：

- 使用 ESLint 进行代码检查
- 使用 Prettier 进行代码格式化
- 变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`
- React 组件使用 `PascalCase`

### 通用规范

- 使用有意义的变量和函数名
- 为复杂逻辑添加注释
- 保持函数简洁（不超过 50 行）
- 避免代码重复

## 开发环境设置

### 前端开发

```bash
cd frontend

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 运行 lint
pnpm lint
```

### 后端开发

```bash
cd backend

# 安装依赖
go mod download

# 启动开发服务器
make run

# 运行测试
make test
```

### 数据库设置

```bash
# 生成 Prisma 客户端
bun run db:generate

# 推送 schema 到数据库
bun run db:push
```

## 报告 Bug

### 如何报告

1. 使用 [GitHub Issues](https://github.com/your-username/DarkForest/issues) 创建 Issue
2. 使用 Bug 报告模板
3. 提供详细信息

### Bug 报告内容

- **问题描述**：清晰描述遇到的问题
- **复现步骤**：如何触发 Bug
- **期望行为**：应该发生什么
- **实际行为**：实际发生了什么
- **环境信息**：操作系统、浏览器、版本等
- **截图/日志**：如有帮助，提供截图或日志

## 提出新功能

### 如何提议

1. 使用 [GitHub Issues](https://github.com/your-username/DarkForest/issues) 创建 Issue
2. 标记为 "enhancement"
3. 详细描述功能

### 功能建议内容

- **功能描述**：详细描述新功能
- **使用场景**：为什么需要这个功能
- **实现思路**：如有想法，提供实现思路
- **替代方案**：是否有其他解决方案

## 行为准则

- 尊重所有贡献者
- 使用友好、包容的语言
- 接受建设性批评
- 关注对社区最有利的事情

## 获取帮助

- **GitHub Issues**：提交问题或建议
- **GitHub Discussions**：讨论想法或寻求帮助
- **代码审查**：在 PR 中提问

## 许可证

贡献的代码将采用项目的 MIT 许可证。

---

感谢您的贡献！🎉