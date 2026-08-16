package api

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
	"github.com/darkforest/backend/internal/rooms"
	"github.com/google/uuid"
)

// TestGameHandler 处理测试游戏注入 API。
// 仅在 E2E_TEST_API=1 环境下可用，生产环境返回 404。
type TestGameHandler struct {
	queries     *db.Queries
	roomManager *rooms.RoomManager
}

func NewTestGameHandler(q *db.Queries, rm *rooms.RoomManager) *TestGameHandler {
	return &TestGameHandler{queries: q, roomManager: rm}
}

type TestGameRequest struct {
	GameState game.GameState `json:"gameState"`
}

type TestGameResponse struct {
	Success bool   `json:"success"`
	RoomID  string `json:"roomId"`
	GameID  string `json:"gameId"`
}

// CreateTestGame 接收完整 GameState，创建房间并注入状态。
// 鉴权由 AuthMiddleware + AdminRequiredMiddleware 完成。
// env 守卫：未设 E2E_TEST_API 时返回 404。
func (h *TestGameHandler) CreateTestGame(w http.ResponseWriter, r *http.Request) {
	// 1. env 守卫：未设 E2E_TEST_API 时返回 404，生产环境无副作用
	if os.Getenv("E2E_TEST_API") != "1" {
		http.NotFound(w, r)
		return
	}

	if r.Method != http.MethodPost {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 2. 解析请求体
	var req TestGameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, "无效的请求体: "+err.Error(), http.StatusBadRequest)
		return
	}

	gs := req.GameState

	// 3. GameState 一致性校验（D10）
	if len(gs.Players) == 0 {
		WriteJSONError(w, "gameState.players 不能为空", http.StatusBadRequest)
		return
	}
	if gs.PlayerCount != len(gs.Players) {
		WriteJSONError(w, "playerCount 与 players 长度不一致", http.StatusBadRequest)
		return
	}
	// currentPlayerId 必须在 players 中
	currentPlayerFound := false
	for _, p := range gs.Players {
		if p.ID == gs.CurrentPlayerID {
			currentPlayerFound = true
			break
		}
	}
	if !currentPlayerFound {
		WriteJSONError(w, "currentPlayerId 不在 players 中", http.StatusBadRequest)
		return
	}

	// 4. 校验玩家 ID 存在性（查 DB）+ 收集 PlayerInfo + 校验卡牌 UID 唯一性
	playerInfos := make([]*hub.PlayerInfo, 0, len(gs.Players))
	cardUIDs := make(map[string]bool)
	for _, p := range gs.Players {
		// 校验手牌 UID 唯一性
		for _, c := range p.Hand {
			if cardUIDs[c.UID] {
				WriteJSONError(w, "重复的卡牌 UID: "+c.UID, http.StatusBadRequest)
				return
			}
			cardUIDs[c.UID] = true
		}

		// 查 DB 验证玩家存在
		if _, err := uuid.Parse(p.ID); err != nil {
			WriteJSONError(w, "无效的玩家 ID: "+p.ID, http.StatusBadRequest)
			return
		}
		dbPlayer, err := h.queries.GetPlayerByID(r.Context(), p.ID)
		if err != nil {
			WriteJSONError(w, "玩家 ID 不存在: "+p.ID, http.StatusBadRequest)
			return
		}

		playerInfos = append(playerInfos, &hub.PlayerInfo{
			ID:          p.ID,
			UserID:      dbPlayer.UserID,
			DisplayName: dbPlayer.DisplayName,
			Role:        dbPlayer.Role,
		})
	}
	// 校验抽牌堆 UID 唯一性
	for _, c := range gs.DrawPile {
		if cardUIDs[c.UID] {
			WriteJSONError(w, "重复的卡牌 UID（抽牌堆）: "+c.UID, http.StatusBadRequest)
			return
		}
		cardUIDs[c.UID] = true
	}
	for _, c := range gs.DiscardPile {
		if cardUIDs[c.UID] {
			WriteJSONError(w, "重复的卡牌 UID（弃牌堆）: "+c.UID, http.StatusBadRequest)
			return
		}
		cardUIDs[c.UID] = true
	}

	// 5. 创建 room 并预添加玩家
	roomID := "test_" + uuid.New().String()[:8]
	room := h.roomManager.GetOrCreateRoom(roomID, len(gs.Players))
	for _, pi := range playerInfos {
		// 先通过 room.AddPlayer 添加（State=Waiting 阶段）
		room.AddPlayer(pi)
		// 再通过 JoinRoom 设置 playerToRoom 映射 + 广播 room:playerJoined
		if _, err := h.roomManager.JoinRoom(pi, roomID); err != nil {
			WriteJSONError(w, "JoinRoom 失败: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// 6. 注入 GameState（State: Waiting → Playing）
	if err := room.SetGameState(&gs); err != nil {
		WriteJSONError(w, "SetGameState 失败: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// 7. 为每个玩家写入 activeGameByPlayer 索引，使注入式对局也能被重连发现
	for _, pi := range playerInfos {
		h.roomManager.SetActiveGame(pi.ID, roomID)
	}

	// 8. 返回结果
	gameID := uuid.New().String()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TestGameResponse{
		Success: true,
		RoomID:  roomID,
		GameID:  gameID,
	})
}
