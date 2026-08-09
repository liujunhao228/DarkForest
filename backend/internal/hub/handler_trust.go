package hub

import (
	"context"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// qqNumericRegex 校验 qq 参数为纯数字。
var qqNumericRegex = regexp.MustCompile(`^[0-9]+$`)

// sidAgentRegex 校验 agent 的 sid（user_id 后缀）为 ASCII [A-Za-z0-9_-]{1,64}。
var sidAgentRegex = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// TrustModeHandler 返回 LOCAL_TRUST_MODE 专用的 /ws handler。
// 仅接受来源 IP 为 127.0.0.1 或 ::1 的连接，支持 ?qq=<n>&name=<nick> 与
// ?sid=<s>&name=<nick?> 两种入口：qq 分支按 qq:<n> get-or-create player，
// agent 分支按 agent:<sid> 走两段式 get-or-create（行不存在才回退 AI-<sid>，
// 行已有缺 name 时保留既有昵称，M3）。免 JWT。
func TrustModeHandler(h *Hub, queries *db.Queries) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// (1) localhost-only IP 校验
		// net.SplitHostPort 对 IPv4 "1.2.3.4:port" 与 IPv6 "[::1]:port"
		// 均返回去括号的 host（IPv6 为 "::1"）。
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "trust mode requires localhost", http.StatusForbidden)
			return
		}
		if host != "127.0.0.1" && host != "::1" {
			http.Error(w, "trust mode requires localhost", http.StatusForbidden)
			return
		}

		// (2) 解析查询参数
		qq := r.URL.Query().Get("qq")
		sid := r.URL.Query().Get("sid")
		name := r.URL.Query().Get("name")

		// (3) 二选一：优先 qq（既有行为逐字保留），否则 sid（agent 分支）
		var userID string
		switch {
		case qq != "":
			if !qqNumericRegex.MatchString(qq) {
				http.Error(w, "invalid qq or name", http.StatusBadRequest)
				return
			}
			userID = "qq:" + qq
		case sid != "":
			if !sidAgentRegex.MatchString(sid) {
				http.Error(w, "invalid sid", http.StatusBadRequest)
				return
			}
			userID = "agent:" + sid
		default:
			http.Error(w, "invalid qq or name", http.StatusBadRequest)
			return
		}

		// (4) name 归一：trim + 截断 255；qq 分支缺 name 报 400（既有行为）。
		//     **sid 分支缺 name 不在此处回退（M3）**：保持空值，交给 (6) 两段式
		//     get-or-create 决定（行已存在 → 保留既有昵称；行不存在 → AI-<sid>）。
		name = strings.TrimSpace(name)
		if name == "" && qq != "" {
			http.Error(w, "invalid qq or name", http.StatusBadRequest)
			return
		}
		if len(name) > 255 {
			name = name[:255]
		}

		// (5) DB 查询超时控制
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		// (6) 两段式 get-or-create：
		//   - sid 分支 name 为空时：行已存在 → 沿用既有 display_name（不被 AI-<sid> 覆盖，M3）；
		//     行不存在 → 回退 AI-<sid>。与 HTTP 两段逻辑同构。
		//   - qq 分支 / sid 分支带 name → 直接用 name（upsert 覆盖，P2 场景语义）。
		resolvedName := name
		if sid != "" && resolvedName == "" {
			existing, err := queries.GetPlayerByUserID(ctx, userID)
			switch {
			case err == nil:
				resolvedName = existing.DisplayName
			case errors.Is(err, pgx.ErrNoRows):
				resolvedName = "AI-" + sid
			default:
				http.Error(w, "failed to get player", http.StatusInternalServerError)
				return
			}
		}
		player, err := queries.GetOrCreatePlayerByUserID(ctx, db.GetOrCreatePlayerByUserIDParams{
			UserID:      userID,
			DisplayName: resolvedName,
		})
		if err != nil {
			http.Error(w, "failed to get or create player", http.StatusInternalServerError)
			return
		}

		// (7) 构造与 JWT 路径同构的 payload（role 恒 player，无提权）
		payload := auth.JWTPayload{
			PlayerID:    uuid.UUID(player.ID.Bytes).String(),
			UserID:      player.UserID,
			Role:        "player", // 恒 player；qq/sid 分支均不继承 DB 行任意高角色
			DisplayName: player.DisplayName,
		}

		// (8) 复用共享的 WS 升级与注册逻辑（空 echoProtocol：trust 路径无 token 需回显）
		upgradeAndRegister(w, r, h, payload, "")
	}
}
