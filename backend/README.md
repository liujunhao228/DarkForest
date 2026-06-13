# DarkForest Backend

基于 Go 语言的后端服务，为 DarkForest 游戏提供 API 和 WebSocket 支持。

## 快速开始

### 环境要求

- Go 1.21 或更高版本
- Make（可选）

### 安装

```bash
# 克隆仓库
cd backend

# 安装依赖
go mod download
```

### 配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置必要的环境变量
```

### 运行

```bash
# 使用 Make
make run

# 或直接使用 Go
go run ./cmd/server
```

服务器将在 `http://localhost:8080` 启动。

### 构建

```bash
make build
# 或
go build -o bin/server ./cmd/server
```

### 测试

```bash
make test
# 或
go test ./...
```

## 项目结构

```
backend/
├── cmd/
│   └── server/        # 应用入口
├── internal/
│   ├── api/           # API 路由和处理器
│   ├── auth/          # 认证和授权
│   ├── config/        # 配置管理
│   ├── db/            # 数据库连接和迁移
│   ├── game/          # 游戏逻辑
│   ├── matchmaking/   # 匹配系统
│   ├── models/        # 数据模型
│   ├── replay/        # 回放系统
│   ├── rooms/         # 房间管理
│   └── websocket/     # WebSocket 处理
├── pkg/
│   └── logger/        # 日志工具
├── queries/           # SQL 查询文件
├── test/              # 集成测试
├── Makefile
├── go.mod
└── go.sum
```

## 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| DATABASE_URL | 数据库连接字符串 | file:./dev.db |
| JWT_SECRET | JWT 签名密钥 | - |
| ADMIN_SECRET_KEY | 管理员密钥 | - |
| PORT | 服务端口 | 8080 |

## 开发

```bash
# 格式化代码
go fmt ./...

# 静态检查
go vet ./...

# 运行测试
go test ./...
```

## 代码规范

### 强制检查

在提交代码前，必须通过以下检查：

```bash
# 格式化代码（必须）
gofmt -w .

# 静态分析（必须）
go vet ./...
```

建议在 CI/CD 流程中集成这些检查，确保代码质量。

### 错误处理

#### 错误包装

使用 `fmt.Errorf` 和 `%w` 格式化动词进行错误包装，保留错误链：

```go
// ✅ 正确：使用 %w 包装错误
func getUser(id string) (*User, error) {
    user, err := db.FindUser(id)
    if err != nil {
        return nil, fmt.Errorf("failed to find user %s: %w", id, err)
    }
    return user, nil
}

// ❌ 错误：使用 %v 会丢失错误链
return nil, fmt.Errorf("failed to find user %s: %v", id, err)
```

#### 错误变量命名

导出的错误变量使用 `Err` 前缀，私有错误变量使用 `err` 前缀：

```go
// ✅ 正确：导出错误变量
var ErrUserNotFound = errors.New("user not found")
var ErrInvalidInput = errors.New("invalid input")

// ✅ 正确：私有错误变量
var errConnectionFailed = errors.New("connection failed")
```

#### 错误检查

使用 `errors.Is` 和 `errors.As` 进行错误判断：

```go
// ✅ 正确：使用 errors.Is 检查错误类型
if errors.Is(err, ErrUserNotFound) {
    // 处理用户未找到
}

// ✅ 正确：使用 errors.As 提取错误详情
var customErr *CustomError
if errors.As(err, &customErr) {
    // 处理自定义错误
}
```

### 命名约定

#### 包命名

- 使用简短、有意义的小写名称
- 避免使用下划线或驼峰命名
- 包名应与目录名一致

```go
// ✅ 正确
package matchmaking
package game

// ❌ 错误
package matchmaking_service
package GameEngine
```

#### 函数命名

- 导出函数使用 `PascalCase`
- 私有函数使用 `camelCase`
- 函数名应以动词开头，描述行为

```go
// ✅ 正确：导出函数
func CreateRoom(playerID string) (*Room, error) { ... }
func JoinMatchmaking(playerID string, count int) error { ... }

// ✅ 正确：私有函数
func validatePlayer(playerID string) error { ... }
func calculateScore(moves []Move) int { ... }

// ❌ 错误
func room_create(playerID string) { ... }  // 下划线命名
func PlayerJoin(id string) { ... }          // 缺少动词
```

#### 变量命名

- 使用有意义的名称，避免缩写
- 局部变量可以使用短名称（如 `i`, `id`）
- 布尔变量使用 `is`, `has`, `can` 等前缀

```go
// ✅ 正确
playerCount := 4
isValid := true
hasPermission := false
roomManager := NewRoomManager()

// ❌ 错误
pc := 4                    // 过度缩写
flag := true               // 不明确
rm := NewRoomManager()     // 过度缩写
```

#### 常量命名

- 使用 `PascalCase` 或 `UPPER_SNAKE_CASE`
- 导出常量使用 `PascalCase`

```go
// ✅ 正确
const MaxPlayers = 5
const MinPlayers = 3
const DEFAULT_TIMEOUT = 30000

// ❌ 错误
const max_players = 5      // 混合风格
const defaultTimeout = 30  // 应该导出
```

### 注释约定

#### 包注释

在 `package` 语句前添加包级别注释：

```go
// Package matchmaking 实现了玩家匹配系统。
// 支持自动匹配、房间创建和玩家队列管理。
package matchmaking
```

#### 函数注释

导出函数必须添加注释，说明功能、参数和返回值：

```go
// JoinQueue 将玩家加入匹配队列。
// 参数：
//   - playerID: 玩家唯一标识符
//   - playerCount: 期望的玩家数量（3-5）
//
// 返回：
//   - success: 是否成功加入队列
//   - error: 错误信息（如已在队列中）
func JoinQueue(playerID string, playerCount int) (success bool, err error) {
    // 实现...
}
```

#### 行内注释

解释复杂逻辑或非显而易见的代码：

```go
// 检查玩家是否已在队列中，避免重复加入
existingQueue, err := db.FindQueueByPlayer(playerID)
if err != nil {
    return false, fmt.Errorf("check existing queue: %w", err)
}
```

### 代码组织

#### 文件结构

```go
// 1. 包声明
package matchmaking

// 2. 导入（标准库 → 第三方库 → 项目内部包）
import (
    "context"
    "fmt"
    "time"

    "github.com/google/uuid"
    
    "github.com/darkforest/backend/internal/db"
)

// 3. 常量定义
const (
    MaxPlayers = 5
    Timeout    = 30 * time.Second
)

// 4. 变量定义
var (
    ErrQueueFull = errors.New("queue is full")
)

// 5. 类型定义
type MatchRoom struct {
    ID      string
    Players []Player
}

// 6. 初始化函数
func init() {
    // 初始化逻辑
}

// 7. 导出函数
func CreateRoom() (*Room, error) { ... }

// 8. 私有函数
func validateRoom(room *Room) error { ... }
```

#### 接口定义

```go
// ✅ 正确：接口命名使用 -er 后缀
type Matcher interface {
    Match(ctx context.Context) (*Room, error)
}

type PlayerStore interface {
    Get(id string) (*Player, error)
    Save(player *Player) error
}
```

### 测试规范

#### 测试文件

- 测试文件命名为 `xxx_test.go`
- 测试函数命名为 `TestXxx`
- 使用 `t.Run` 组织子测试

```go
func TestJoinQueue(t *testing.T) {
    t.Run("should join queue successfully", func(t *testing.T) {
        // 测试代码
    })
    
    t.Run("should return error when already in queue", func(t *testing.T) {
        // 测试代码
    })
}
```

#### 表驱动测试

```go
func TestValidatePlayer(t *testing.T) {
    tests := []struct {
        name    string
        input   string
        wantErr bool
    }{
        {"valid id", "player-123", false},
        {"empty id", "", true},
        {"invalid format", "invalid!", true},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := ValidatePlayer(tt.input)
            if (err != nil) != tt.wantErr {
                t.Errorf("ValidatePlayer() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

## License

MIT