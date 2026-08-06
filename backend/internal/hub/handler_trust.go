package hub

import (
	"context"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/db"
	"github.com/google/uuid"
)

// qqNumericRegex 校验 qq 参数为纯数字。
var qqNumericRegex = regexp.MustCompile(`^[0-9]+$`)

// TrustModeHandler 返回 LOCAL_TRUST_MODE 专用的 /ws handler。
// 仅接受来源 IP 为 127.0.0.1 或 ::1 的连接，按 ?qq=<n>&name=<nick>
// 自动 get-or-create player 并完成 WS 升级与注册。免 JWT。
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
		name := r.URL.Query().Get("name")

		// (3) 校验：qq 非空且纯数字，name trim 后非空
		if qq == "" || !qqNumericRegex.MatchString(qq) {
			http.Error(w, "invalid qq or name", http.StatusBadRequest)
			return
		}
		name = strings.TrimSpace(name)
		if name == "" {
			http.Error(w, "invalid qq or name", http.StatusBadRequest)
			return
		}

		// (4) 截断 name 到 255 字符（display_name 列长度限制）
		if len(name) > 255 {
			name = name[:255]
		}

		// (5) DB 查询超时控制
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		// (6) 按 qq:<n> get-or-create player
		player, err := queries.GetOrCreatePlayerByUserID(ctx, db.GetOrCreatePlayerByUserIDParams{
			UserID:      "qq:" + qq,
			DisplayName: name,
		})
		if err != nil {
			http.Error(w, "failed to get or create player", http.StatusInternalServerError)
			return
		}

		// (7) 构造与 JWT 路径同构的 payload
		payload := auth.JWTPayload{
			PlayerID:    uuid.UUID(player.ID.Bytes).String(),
			UserID:      player.UserID,
			Role:        player.Role,
			DisplayName: player.DisplayName,
		}

		// (8) 复用共享的 WS 升级与注册逻辑（空 echoProtocol：trust 路径无 token 需回显）
		upgradeAndRegister(w, r, h, payload, "")
	}
}
