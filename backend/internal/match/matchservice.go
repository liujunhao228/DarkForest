package match

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/darkforest/backend/internal/hub"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	MatchCheckInterval = 5 * time.Second
)

type MatchService struct {
	queries     *db.Queries
	hub         *hub.Hub
	logger      *slog.Logger
	quit        chan struct{}
	running     bool
	mu          sync.Mutex
	roomCreator hub.RoomsCreatorFunc

	// playerModes 记录每个排队玩家请求的 gameMode（in-memory，进程重启后丢失）。
	// key: playerID (UUID string), value: gameMode string（空串=classic）。
	// 用于在 roomsCreator 创建房间时将 gameMode 透传至 InitConfig.GameMode。
	playerModes map[string]string
}

type MatchPlayerInfo struct {
	PlayerID     string `json:"playerId"`
	DisplayName  string `json:"displayName"`
	IsHost       bool   `json:"isHost"`
	PlayerNumber int32  `json:"playerNumber"`
	Position     int32  `json:"position"`
}

type MatchResult struct {
	Success bool       `json:"success"`
	Match   *MatchInfo `json:"match,omitempty"`
	Error   string     `json:"error,omitempty"`
}

type MatchInfo struct {
	ID       string            `json:"id"`
	RoomCode string            `json:"roomCode"`
	HostID   string            `json:"hostId"`
	Players  []MatchPlayerInfo `json:"players"`
}

type QueueStatus = hub.QueueStatus

// FindMatchesResult holds the result of finding matches (alias for hub.FindMatchesResult)
type FindMatchesResult = hub.FindMatchesResult

// CustomQueueInfo represents a custom match queue (alias for hub.CustomQueueInfo)
type CustomQueueInfo = hub.CustomQueueInfo

// CustomQueuePlayerInfo represents a player in a custom queue (alias for hub.CustomQueuePlayerInfo)
type CustomQueuePlayerInfo = hub.CustomQueuePlayerInfo

// CreateCustomQueueParams holds parameters for creating a custom queue (alias for hub.CreateCustomQueueParams)
type CreateCustomQueueParams = hub.CreateCustomQueueParams

// CreateCustomQueueResult holds the result of creating a custom queue (alias for hub.CreateCustomQueueResult)
type CreateCustomQueueResult = hub.CreateCustomQueueResult

// JoinCustomQueueParams holds parameters for joining a custom queue (alias for hub.JoinCustomQueueParams)
type JoinCustomQueueParams = hub.JoinCustomQueueParams

// JoinCustomQueueResult holds the result of joining a custom queue (alias for hub.JoinCustomQueueResult)
type JoinCustomQueueResult = hub.JoinCustomQueueResult

func NewMatchService(queries *db.Queries, hub *hub.Hub, logger *slog.Logger) *MatchService {
	return &MatchService{
		queries:     queries,
		hub:         hub,
		logger:      logger,
		quit:        make(chan struct{}),
		playerModes: make(map[string]string),
	}
}

func (s *MatchService) SetRoomCreator(rc hub.RoomsCreatorFunc) {
	s.roomCreator = rc
}

func (s *MatchService) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	go s.matchmakingLoop()
	s.logger.Info("matchmaking service started")
}

func (s *MatchService) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	s.mu.Unlock()

	close(s.quit)
	s.logger.Info("matchmaking service stopped")
}

func (s *MatchService) matchmakingLoop() {
	ticker := time.NewTicker(MatchCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.tryMatch()
		case <-s.quit:
			return
		}
	}
}

func (s *MatchService) tryMatch() {
	ctx := context.Background()
	result, err := s.FindMatches(ctx)
	if err != nil {
		s.logger.Error("find matches failed", "error", err)
		return
	}

	if len(result.Matches) == 0 {
		return
	}

	s.logger.Info("matches found", "count", len(result.Matches))

	for _, playerIDs := range result.Matches {
		// 批量原子移除，防止下一轮 tryMatch 重复匹配
		s.clearFromQueue(ctx, playerIDs)

		matchResult, err := s.CreateMatchRoom(ctx, playerIDs)
		if err != nil {
			s.logger.Error("create match room failed", "error", err)
			s.reAddToQueue(ctx, playerIDs)
			continue
		}

		if matchResult.Success && matchResult.Match != nil {
			s.notifyMatchFound(matchResult.Match, matchResult.Match.RoomCode)

			// Trigger room creator callback to join players and start the game.
			// Pass matchID (UUID) for replay storage and roomCode as roomID.
			if s.roomCreator != nil {
				if err := s.roomCreator(matchResult.Match.ID, matchResult.Match.RoomCode, playerIDs); err != nil {
					s.logger.Error("roomCreator failed in tryMatch", "roomCode", matchResult.Match.RoomCode, "error", err)
					// 通知所有受影响玩家匹配失败，前端应重置到菜单并允许重新排队。
					errPayload, _ := json.Marshal(map[string]interface{}{
						"message": "房间创建失败，请重新排队",
					})
					for _, pid := range playerIDs {
						if client, ok := s.hub.GetClientByPlayerID(pid); ok {
							client.Send(hub.Message{
								Type:    string(hub.EvtSrvMatchError),
								Payload: errPayload,
							})
						}
					}
				}
			}
		} else {
			// CreateMatchRoom 返回失败，回滚队列
			s.reAddToQueue(ctx, playerIDs)
		}
	}
}

// notifyMatchFound 给匹配到的每个玩家发送 match:found 事件。
// roomID 参数指定消息中使用的房间标识（快速匹配用 roomCode，自定义队列用 queueId），
// 必须与后续 roomCreator 创建房间时使用的 roomID 一致，否则前端无法将 match:found
// 与 room:joined 关联到同一房间。
func (s *MatchService) notifyMatchFound(match *MatchInfo, roomID string) {
	for _, player := range match.Players {
		// Build per-player payload: rename `id` to `roomId` and add top-level `isHost`
		// to match the frontend MatchInfo interface expectation.
		payload, _ := json.Marshal(map[string]interface{}{
			"roomId":   match.ID,
			"roomCode": roomID,
			"hostId":   match.HostID,
			"players":  match.Players,
			"isHost":   player.PlayerID == match.HostID,
		})
		client, ok := s.hub.GetClientByPlayerID(player.PlayerID)
		if ok {
			client.Send(hub.Message{
				Type:    string(hub.EvtSrvMatchFound),
				RoomID:  roomID,
				Payload: payload,
			})
		} else {
			s.logger.Warn("notifyMatchFound: player offline, will be caught by roomCreator precheck",
				"playerId", player.PlayerID, "roomId", roomID)
		}
	}
}

// clearFromQueue 批量原子移除匹配玩家，缩短竞态窗口
func (s *MatchService) clearFromQueue(ctx context.Context, playerIDs []string) {
	uids := make([]pgtype.UUID, 0, len(playerIDs))
	for _, pid := range playerIDs {
		if uid, err := parseUUID(pid); err == nil {
			uids = append(uids, uid)
		}
	}
	if err := s.queries.ClearMatchmakingQueue(ctx, uids); err != nil {
		s.logger.Error("clearFromQueue failed", "error", err, "count", len(uids))
	}
	// 注意：不在此清理 playerModes，因为后续 roomsCreator 需要读取 gameMode。
	// playerModes 的清理依赖 LeaveQueue（玩家取消排队）或玩家重新排队时覆盖。
}

// reAddToQueue 在 CreateMatchRoom 失败时将玩家回滚到队列
func (s *MatchService) reAddToQueue(ctx context.Context, playerIDs []string) {
	for _, pid := range playerIDs {
		uid, err := parseUUID(pid)
		if err != nil {
			continue
		}
		// JoinMatchmakingQueue 有 ON CONFLICT DO UPDATE，重新入队安全
		// 此处无法知道原始 preferredCount，用默认值 4
		queueID := uuid.New()
		if _, err := s.queries.JoinMatchmakingQueue(ctx, db.JoinMatchmakingQueueParams{
			ID:             pgtype.UUID{Bytes: queueID, Valid: true},
			PlayerID:       uid,
			PreferredCount: 4,
			Timeout:        0,
		}); err != nil {
			s.logger.Error("reAddToQueue failed", "playerId", pid, "error", err)
		}
	}
}

func (s *MatchService) JoinQueue(ctx context.Context, player *hub.PlayerInfo, preferredCount int, gameMode string) error {
	uid, err := parseUUID(player.ID)
	if err != nil {
		return err
	}

	// 检查玩家是否已在房间/游戏中
	if client, ok := s.hub.GetClientByPlayerID(player.ID); ok {
		if roomID := client.GetRoom(); roomID != "" {
			return fmt.Errorf("玩家已在房间中: %s", roomID)
		}
	}

	queueID := uuid.New()
	pgQueueID := pgtype.UUID{Bytes: queueID, Valid: true}

	_, err = s.queries.JoinMatchmakingQueue(ctx, db.JoinMatchmakingQueueParams{
		ID:             pgQueueID,
		PlayerID:       uid,
		PreferredCount: int32(preferredCount),
		Timeout:        0,
	})
	if err != nil {
		return err
	}

	// 记录玩家请求的 gameMode（in-memory），供 roomsCreator 在创建房间时读取。
	// 空串视为 classic（零值），与 game.GameModeClassic 等价。
	s.mu.Lock()
	s.playerModes[player.ID] = gameMode
	s.mu.Unlock()

	return nil
}

// GetPlayerGameMode 返回玩家排队时请求的 gameMode（空串=classic）。
// 由 roomsCreator 在创建房间时调用，用于将 gameMode 透传至 InitConfig.GameMode。
func (s *MatchService) GetPlayerGameMode(playerID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.playerModes[playerID]
}

func (s *MatchService) LeaveQueue(ctx context.Context, playerID string) error {
	uid, err := parseUUID(playerID)
	if err != nil {
		return err
	}

	s.mu.Lock()
	delete(s.playerModes, playerID)
	s.mu.Unlock()

	return s.queries.LeaveMatchmakingQueue(ctx, uid)
}

func (s *MatchService) GetQueueStatus(ctx context.Context, playerID string) (*QueueStatus, error) {
	uid, err := parseUUID(playerID)
	if err != nil {
		return nil, err
	}

	queue, err := s.queries.GetPlayerInQueue(ctx, uid)
	if err != nil {
		return &QueueStatus{InQueue: false}, nil
	}

	if !queue.PlayerID.Valid {
		return &QueueStatus{InQueue: false}, nil
	}

	queues, err := s.queries.GetAllQueues(ctx)
	if err != nil {
		return nil, err
	}

	position := 0
	for i, q := range queues {
		if uuidString(q.PlayerID) == playerID {
			position = i + 1 // 1-indexed，与 JoinCustomQueue / 房间玩家列表口径一致
			break
		}
	}

	return &QueueStatus{
		InQueue:      true,
		Position:     position,
		TotalInQueue: len(queues),
	}, nil
}

func (s *MatchService) FindMatches(ctx context.Context) (*FindMatchesResult, error) {
	queues, err := s.queries.GetAllQueues(ctx)
	if err != nil {
		return nil, err
	}

	if len(queues) < 2 {
		return &FindMatchesResult{Matches: [][]string{}}, nil
	}

	matches := [][]string{}
	usedPlayerIDs := make(map[string]bool)

	queuesByCount := make(map[int32][]db.MatchmakingQueue)
	for _, q := range queues {
		count := q.PreferredCount
		if _, ok := queuesByCount[count]; !ok {
			queuesByCount[count] = []db.MatchmakingQueue{}
		}
		queuesByCount[count] = append(queuesByCount[count], q)
	}

	for count, queueList := range queuesByCount {
		available := []db.MatchmakingQueue{}
		for _, q := range queueList {
			if !usedPlayerIDs[uuidString(q.PlayerID)] {
				available = append(available, q)
			}
		}

		if len(available) >= int(count) {
			matchPlayers := []string{}
			for i := 0; i < int(count); i++ {
				pID := uuidString(available[i].PlayerID)
				matchPlayers = append(matchPlayers, pID)
				usedPlayerIDs[pID] = true
			}
			matches = append(matches, matchPlayers)
		}
	}

	return &FindMatchesResult{Matches: matches}, nil
}

func (s *MatchService) CreateMatchRoom(ctx context.Context, playerIDs []string) (*MatchResult, error) {
	roomCode := generateRoomCode()
	hostID := playerIDs[0]

	positions := shuffleInts([]int{1, 2, 3, 4, 5, 6, 7, 8, 9})[:len(playerIDs)]

	hostUUID, err := parseUUID(hostID)
	if err != nil {
		return &MatchResult{Success: false, Error: "无效的主机ID"}, nil
	}

	matchID := uuid.New()
	pgMatchID := pgtype.UUID{Bytes: matchID, Valid: true}

	_, err = s.queries.CreateMatch(ctx, db.CreateMatchParams{
		ID:          pgMatchID,
		RoomCode:    roomCode,
		HostID:      hostUUID,
		Status:      "waiting",
		PlayerCount: int32(len(playerIDs)),
		AiCount:     0,
	})
	if err != nil {
		return &MatchResult{Success: false, Error: "创建对局失败"}, err
	}

	players := []MatchPlayerInfo{}

	for i, playerID := range playerIDs {
		pUUID, err := parseUUID(playerID)
		if err != nil {
			s.logger.Warn("createMatchRoom: invalid player UUID, skipping", "playerId", playerID, "error", err)
			continue
		}

		player, err := s.queries.GetPlayerByID(ctx, pUUID)
		if err != nil {
			s.logger.Warn("createMatchRoom: player not found, skipping", "playerId", playerID, "error", err)
			continue
		}

		mpID := uuid.New()
		pgMPID := pgtype.UUID{Bytes: mpID, Valid: true}

		_, err = s.queries.AddPlayerToMatch(ctx, db.AddPlayerToMatchParams{
			ID:           pgMPID,
			MatchID:      pgMatchID,
			PlayerID:     pUUID,
			PlayerNumber: int32(i),
			IsHost:       i == 0,
			Position:     int32(positions[i]),
		})
		if err != nil {
			s.logger.Warn("createMatchRoom: addPlayerToMatch failed, skipping", "playerId", playerID, "error", err)
			continue
		}

		players = append(players, MatchPlayerInfo{
			PlayerID:     playerID,
			DisplayName:  player.DisplayName,
			IsHost:       i == 0,
			PlayerNumber: int32(i),
			Position:     int32(positions[i]),
		})
	}

	if len(players) < 2 {
		return &MatchResult{Success: false, Error: "有效玩家数不足"}, nil
	}

	return &MatchResult{
		Success: true,
		Match: &MatchInfo{
			ID:       uuidString(pgMatchID),
			RoomCode: roomCode,
			HostID:   hostID,
			Players:  players,
		},
	}, nil
}

func (s *MatchService) GetMatchRoom(ctx context.Context, roomCode string) (*MatchInfo, error) {
	match, err := s.queries.GetMatchByRoomCode(ctx, roomCode)
	if err != nil {
		return nil, err
	}

	players, err := s.queries.ListPlayersByMatch(ctx, match.ID)
	if err != nil {
		return nil, err
	}

	matchPlayers := []MatchPlayerInfo{}
	for _, mp := range players {
		player, err := s.queries.GetPlayerByID(ctx, mp.PlayerID)
		if err != nil {
			continue
		}

		matchPlayers = append(matchPlayers, MatchPlayerInfo{
			PlayerID:     uuidString(mp.PlayerID),
			DisplayName:  player.DisplayName,
			IsHost:       mp.IsHost,
			PlayerNumber: mp.PlayerNumber,
			Position:     mp.Position,
		})
	}

	return &MatchInfo{
		ID:       uuidString(match.ID),
		RoomCode: match.RoomCode,
		HostID:   uuidString(match.HostID),
		Players:  matchPlayers,
	}, nil
}

func generateRoomCode() string {
	chars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	bytes := make([]byte, 6)
	if _, err := cryptorand.Read(bytes); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	var code string
	for _, b := range bytes {
		code += string(chars[int(b)%len(chars)])
	}
	return code
}

func shuffleInts(arr []int) []int {
	a := make([]int, len(arr))
	copy(a, arr)
	for i := len(a) - 1; i > 0; i-- {
		// 用 crypto/rand 生成 [0, i] 范围随机数
		b := make([]byte, 8)
		if _, err := cryptorand.Read(b); err != nil {
			panic("crypto/rand failed: " + err.Error())
		}
		var n int64
		for j, v := range b {
			n |= int64(v) << (uint(j) * 8)
		}
		if n < 0 {
			n = -n
		}
		j := int(n % int64(i+1))
		a[i], a[j] = a[j], a[i]
	}
	return a
}

func uuidString(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}

func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

// ============================
// Custom Queue Methods
// ============================

// generateQueueId generates a random queue ID for custom queues
func generateQueueId() string {
	chars := "abcdefghijklmnopqrstuvwxyz0123456789"
	bytes := make([]byte, 8)
	if _, err := cryptorand.Read(bytes); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	var id string
	for _, b := range bytes {
		id += string(chars[int(b)%len(chars)])
	}
	return id
}

// CreateCustomQueue creates a new custom match queue
func (s *MatchService) CreateCustomQueue(ctx context.Context, params CreateCustomQueueParams) (*CreateCustomQueueResult, error) {
	// Validate player ID
	playerUUID, err := parseUUID(params.PlayerID)
	if err != nil {
		return &CreateCustomQueueResult{Success: false, Error: "无效的玩家ID"}, nil
	}

	// Validate player exists
	player, err := s.queries.GetPlayerByID(ctx, playerUUID)
	if err != nil {
		return &CreateCustomQueueResult{Success: false, Error: "玩家不存在"}, nil
	}

	// Validate min/max players
	if params.MinPlayers < 3 || params.MaxPlayers > 5 || params.MinPlayers > params.MaxPlayers {
		return &CreateCustomQueueResult{Success: false, Error: "玩家数必须在 3-5 之间，且最小值不能大于最大值"}, nil
	}

	// 敏感词校验：队列名命中即拒绝创建
	if _, err := game.SanitizeUserText(params.QueueName, game.SanitizeContextQueueName); err != nil {
		return &CreateCustomQueueResult{Success: false, Error: "队列名包含违规内容"}, nil
	}

	// Generate queue ID
	queueId := generateQueueId()

	// Create the custom queue
	queueUUID, err := s.queries.CreateCustomMatchQueue(ctx, db.CreateCustomMatchQueueParams{
		QueueID:    queueId,
		QueueName:  params.QueueName,
		CreatorID:  playerUUID,
		MinPlayers: params.MinPlayers,
		MaxPlayers: params.MaxPlayers,
	})
	if err != nil {
		s.logger.Error("创建自定义队列失败", "error", err)
		return &CreateCustomQueueResult{Success: false, Error: "创建队列失败"}, nil
	}

	// Add creator to the queue
	err = s.queries.AddPlayerToCustomQueue(ctx, db.AddPlayerToCustomQueueParams{
		QueueID:  queueUUID,
		PlayerID: playerUUID,
	})
	if err != nil {
		s.logger.Error("将创建者加入队列失败", "error", err)
		return &CreateCustomQueueResult{Success: false, Error: "加入队列失败"}, nil
	}

	s.logger.Info("自定义队列创建成功", "queueId", queueId, "creator", player.DisplayName)

	return &CreateCustomQueueResult{
		Success: true,
		QueueID: queueId,
	}, nil
}

// GetCustomQueueInfo retrieves information about a custom queue
func (s *MatchService) GetCustomQueueInfo(ctx context.Context, queueId string) (*CustomQueueInfo, error) {
	queue, err := s.queries.GetCustomMatchQueueByQueueID(ctx, queueId)
	if err != nil {
		return nil, err
	}

	players, err := s.queries.GetCustomMatchQueuePlayers(ctx, queue.ID)
	if err != nil {
		return nil, err
	}

	playerInfos := []CustomQueuePlayerInfo{}
	for _, p := range players {
		playerInfos = append(playerInfos, CustomQueuePlayerInfo{
			PlayerID:    uuidString(p.PlayerID),
			DisplayName: p.DisplayName,
			IsReady:     p.IsReady,
			JoinedAt:    p.JoinedAt.Time.Unix(),
		})
	}

	return &CustomQueueInfo{
		QueueID:    queue.QueueID,
		QueueName:  queue.QueueName,
		CreatorID:  uuidString(queue.CreatorID),
		MinPlayers: queue.MinPlayers,
		MaxPlayers: queue.MaxPlayers,
		Status:     queue.Status,
		Players:    playerInfos,
	}, nil
}

// JoinCustomQueue adds a player to a custom queue
func (s *MatchService) JoinCustomQueue(ctx context.Context, params JoinCustomQueueParams) (*JoinCustomQueueResult, error) {
	// Get queue by queue_id (string)
	queue, err := s.queries.GetCustomMatchQueueByQueueID(ctx, params.QueueID)
	if err != nil {
		return &JoinCustomQueueResult{Success: false, Error: "队列不存在"}, nil
	}

	// Check queue status
	if queue.Status == "full" || queue.Status == "started" {
		return &JoinCustomQueueResult{Success: false, Error: "队列已满或已开始"}, nil
	}

	playerUUID, err := parseUUID(params.PlayerID)
	if err != nil {
		return &JoinCustomQueueResult{Success: false, Error: "无效的玩家ID"}, nil
	}

	// Check if already in queue
	inQueue, err := s.queries.PlayerInCustomQueue(ctx, db.PlayerInCustomQueueParams{
		QueueID:  queue.ID,
		PlayerID: playerUUID,
	})
	if err == nil && inQueue {
		return &JoinCustomQueueResult{Success: false, Error: "已在该队列中"}, nil
	}

	// Add player to queue
	err = s.queries.AddPlayerToCustomQueue(ctx, db.AddPlayerToCustomQueueParams{
		QueueID:  queue.ID,
		PlayerID: playerUUID,
	})
	if err != nil {
		s.logger.Error("加入自定义队列失败", "error", err)
		return &JoinCustomQueueResult{Success: false, Error: "加入队列失败"}, nil
	}

	// Get updated player count
	players, err := s.queries.GetCustomMatchQueuePlayers(ctx, queue.ID)
	if err != nil {
		// 回滚：移除刚加入的玩家，避免 DB 部分写入导致后续重试被 "已在该队列中" 守卫拦截
		if rbErr := s.queries.RemovePlayerFromCustomQueue(ctx, db.RemovePlayerFromCustomQueueParams{
			QueueID:  queue.ID,
			PlayerID: playerUUID,
		}); rbErr != nil {
			s.logger.Error("回滚 AddPlayerToCustomQueue 失败",
				"queueId", params.QueueID, "playerId", params.PlayerID, "error", rbErr)
		}
		return nil, err
	}

	position := 0
	for i, p := range players {
		if uuidString(p.PlayerID) == params.PlayerID {
			position = i + 1
			break
		}
	}

	// Update queue status if full
	newStatus := queue.Status
	playerCount := int32(len(players))
	if playerCount >= queue.MaxPlayers {
		newStatus = "full"
	} else if playerCount >= queue.MinPlayers {
		newStatus = "matching"
	}

	if newStatus != queue.Status {
		s.queries.UpdateCustomQueueStatus(ctx, db.UpdateCustomQueueStatusParams{
			QueueID: queue.ID,
			Status:  newStatus,
		})
	}

	// Broadcast updated queue info to existing queue members so they see the
	// new player immediately. The joining player is excluded here because they
	// receive the dedicated `match:specificQueueJoined` event followed by their
	// own `match:queueInfoResponse` from the `getQueueInfo` request.
	queueInfo, qErr := s.GetCustomQueueInfo(ctx, params.QueueID)
	if qErr == nil {
		broadcastPayload, _ := json.Marshal(queueInfo)
		for _, p := range players {
			pid := uuidString(p.PlayerID)
			if pid == params.PlayerID {
				continue
			}
			if client, ok := s.hub.GetClientByPlayerID(pid); ok {
				client.Send(hub.Message{
					Type:    string(hub.EvtSrvMatchQueueInfoResp),
					Payload: broadcastPayload,
				})
			}
		}
	}

	// If queue is now full, notify room creator to start the game
	if newStatus == "full" && s.roomCreator != nil {
		playerIDs := make([]string, len(players))
		for i, p := range players {
			playerIDs[i] = uuidString(p.PlayerID)
		}

		// Create a match record (with players) so the replay system can
		// reference it via match_id. Use queueID as the roomID.
		matchResult, matchErr := s.CreateMatchRoom(ctx, playerIDs)
		if matchErr != nil || matchResult == nil || !matchResult.Success || matchResult.Match == nil {
			s.logger.Error("CreateMatchRoom failed in JoinCustomQueue", "queueId", params.QueueID, "error", matchErr)

			// Reset queue status so players are not stuck in "full"
			resetStatus := "matching"
			if playerCount < queue.MinPlayers {
				resetStatus = "waiting"
			}
			if resetErr := s.queries.UpdateCustomQueueStatus(ctx, db.UpdateCustomQueueStatusParams{
				QueueID: queue.ID,
				Status:  resetStatus,
			}); resetErr != nil {
				s.logger.Error("failed to reset queue status after CreateMatchRoom failure", "queueId", params.QueueID, "error", resetErr)
			}
			return nil, matchErr
		}

		// 关键修复：在 roomCreator 之前给所有玩家发送 match:found，与快速匹配流程保持一致。
		// 自定义队列满员时，已在队列中的玩家只会收到 match:queueInfoResponse（status=full），
		// 前端仍停留在"队列"状态。若直接发送 room:joined，前端因状态不匹配会判定为连接失败。
		// match:found 让前端先从"队列"状态切换到"准备进入房间"状态，随后才能正确接收 room:joined。
		// 注意：roomID 必须用 params.QueueID（与 roomCreator 使用的 roomID 一致），
		// 而非 matchResult.Match.RoomCode，否则前端无法将 match:found 与 room:joined 关联。
		s.notifyMatchFound(matchResult.Match, params.QueueID)

		if err := s.roomCreator(matchResult.Match.ID, params.QueueID, playerIDs); err != nil {
			// Game failed to start (e.g. a player went offline, or the room
			// could not be created). Reset the queue status so the remaining
			// connected players are not stuck in the "full" state forever.
			s.logger.Error("roomCreator failed, resetting queue status", "queueId", params.QueueID, "error", err)

			isPlayerOffline := errors.Is(err, hub.ErrPlayerNotFound)

			// 若因玩家离线失败，将离线玩家从自定义队列中移除，
			// 否则队列会卡住：离线玩家仍在队列中，队列永远无法再次凑齐。
			if isPlayerOffline {
				for _, pid := range playerIDs {
					if _, online := s.hub.GetClientByPlayerID(pid); !online {
						if pUUID, pErr := parseUUID(pid); pErr == nil {
							if rmErr := s.queries.RemovePlayerFromCustomQueue(ctx, db.RemovePlayerFromCustomQueueParams{
								QueueID:  queue.ID,
								PlayerID: pUUID,
							}); rmErr != nil {
								s.logger.Error("failed to remove offline player from queue", "queueId", params.QueueID, "playerId", pid, "error", rmErr)
							} else {
								s.logger.Info("removed offline player from custom queue", "queueId", params.QueueID, "playerId", pid)
							}
						}
					}
				}
			}

			// 重新获取剩余玩家数以确定正确的队列状态。
			remainingPlayers, remErr := s.queries.GetCustomMatchQueuePlayers(ctx, queue.ID)
			remainingCount := playerCount
			if remErr == nil {
				remainingCount = int32(len(remainingPlayers))
			}

			resetStatus := "matching"
			if remainingCount < queue.MinPlayers {
				resetStatus = "waiting"
			}
			if resetErr := s.queries.UpdateCustomQueueStatus(ctx, db.UpdateCustomQueueStatusParams{
				QueueID: queue.ID,
				Status:  resetStatus,
			}); resetErr != nil {
				s.logger.Error("failed to reset queue status after roomCreator failure", "queueId", params.QueueID, "error", resetErr)
			}

			// 根据失败类型使用不同的错误消息
			errMsg := "房间创建失败，请重新排队"
			if isPlayerOffline {
				errMsg = "有玩家未连接，已将其移出队列"
			}

			// Notify all connected players in the queue that the game start failed
			errPayload, _ := json.Marshal(map[string]interface{}{
				"queueId": params.QueueID,
				"message": errMsg,
				"status":  resetStatus,
			})
			for _, pid := range playerIDs {
				if client, ok := s.hub.GetClientByPlayerID(pid); ok {
					client.Send(hub.Message{
						Type:    string(hub.EvtSrvMatchError),
						Payload: errPayload,
					})
				}
			}

			// 广播更新后的队列信息，使剩余玩家看到离线玩家已被移除
			if isPlayerOffline {
				if updatedInfo, qErr := s.GetCustomQueueInfo(ctx, params.QueueID); qErr == nil {
					infoPayload, _ := json.Marshal(updatedInfo)
					for _, pid := range playerIDs {
						if _, online := s.hub.GetClientByPlayerID(pid); !online {
							continue
						}
						if client, ok := s.hub.GetClientByPlayerID(pid); ok {
							client.Send(hub.Message{
								Type:    string(hub.EvtSrvMatchQueueInfoResp),
								Payload: infoPayload,
							})
						}
					}
				}
			}
		} else {
			// roomCreator 成功：将队列标记为 started，避免下次登录时被 GetPlayerQueues 误恢复
			if statusErr := s.queries.UpdateCustomQueueStatus(ctx, db.UpdateCustomQueueStatusParams{
				QueueID: queue.ID,
				Status:  "started",
			}); statusErr != nil {
				s.logger.Error("failed to mark queue as started", "queueId", params.QueueID, "error", statusErr)
			}
		}
	}

	s.logger.Info("玩家加入自定义队列", "playerId", params.PlayerID, "queueId", params.QueueID, "position", position)

	return &JoinCustomQueueResult{
		Success:      true,
		QueueID:      params.QueueID,
		QueueName:    queue.QueueName,
		Position:     position,
		TotalInQueue: len(players),
	}, nil
}

// LeaveCustomQueue removes a player from a custom queue
func (s *MatchService) LeaveCustomQueue(ctx context.Context, playerID string, queueId string) error {
	playerUUID, err := parseUUID(playerID)
	if err != nil {
		return err
	}

	queue, err := s.queries.GetCustomMatchQueueByQueueID(ctx, queueId)
	if err != nil {
		return err
	}

	err = s.queries.RemovePlayerFromCustomQueue(ctx, db.RemovePlayerFromCustomQueueParams{
		QueueID:  queue.ID,
		PlayerID: playerUUID,
	})
	if err != nil {
		return err
	}

	// Check if queue is now empty and delete it
	s.queries.DeleteEmptyCustomQueue(ctx, queue.ID)

	s.logger.Info("玩家离开自定义队列", "playerId", playerID, "queueId", queueId)
	return nil
}

// GetPlayerQueues returns all queues a player is in
func (s *MatchService) GetPlayerQueues(ctx context.Context, playerID string) ([]CustomQueueInfo, error) {
	playerUUID, err := parseUUID(playerID)
	if err != nil {
		return nil, err
	}

	queues, err := s.queries.GetPlayerCustomQueues(ctx, playerUUID)
	if err != nil {
		return nil, err
	}

	result := []CustomQueueInfo{}
	for _, q := range queues {
		// 过滤已开局(started)或已满(full)的队列，避免下次登录时误恢复
		if q.Status == "started" || q.Status == "full" {
			continue
		}
		queueInfo, err := s.GetCustomQueueInfo(ctx, q.QueueID)
		if err != nil {
			continue
		}
		result = append(result, *queueInfo)
	}

	return result, nil
}
