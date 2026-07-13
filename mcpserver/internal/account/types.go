// Package account 实现游戏账户池:运维方预注册一批账户,Agent 会话借用/归还。
package account

import "time"

// 账户状态常量。
const (
	StatusAvailable = "available" // 可借用
	StatusInUse     = "in_use"    // 已被某 Agent 会话借用
	StatusDisabled  = "disabled"  // 已禁用
)

// Account 表示池中的一个游戏账户。
type Account struct {
	ID          string    // 游戏 player UUID
	DisplayName string    // 登录名
	Password    string    // 明文密码(本地存储,用于刷新 token)
	Token       string    // JWT
	TokenExpiry time.Time // token 过期时间
	PlayerID    string    // 同 ID,保留以便语义清晰
	Role        string    // player / admin
	Status      string    // available / in_use / disabled
	AssignedTo  string    // 当前借用的 MCP session ID
	CreatedAt   time.Time
}

// AuthResult 是注册/登录返回的鉴权结果。
type AuthResult struct {
	Token       string
	PlayerID    string
	DisplayName string
	Role        string
	ExpiresAt   time.Time
}

// AccountRegistrar 抽象账户注册/登录的远程调用,由 gamesdk.HTTPClient 实现。
// 定义在此处以避免 account → gamesdk 的循环依赖。
type AccountRegistrar interface {
	// Register 调用游戏后端 POST /api/auth/register。
	Register(displayName, password, inviteCode string) (*AuthResult, error)
	// Login 调用游戏后端 POST /api/auth/login。
	Login(displayName, password string) (*AuthResult, error)
	// CreateInvite 调用游戏后端 POST /api/auth/invite(需 admin token)。
	CreateInvite(adminToken string) (string, error)
}
