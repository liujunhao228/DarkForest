package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/darkforest/backend/internal/auth"
	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/game"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setupMapHandlerTestDB 尝试连接测试数据库。失败时调用 t.Skip 跳过。
// 与 db_test.go 的 setupMigrationTestDB 行为一致。
func setupMapHandlerTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://darkforest:darkforest_secret@localhost:5432/darkforest?sslmode=disable"
	}

	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Skipf("解析 DATABASE_URL 失败，跳过 MapHandler 测试: %v", err)
	}
	cfg.MaxConns = 2
	cfg.MinConns = 0

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Skipf("无法连接测试数据库，跳过 MapHandler 测试: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("测试数据库不可达，跳过 MapHandler 测试: %v", err)
	}
	return pool
}

// validTestLayout 返回通过 ValidateMap 的 3 节点三角形布局。
func validTestLayout() *game.MapLayoutSnapshot {
	return &game.MapLayoutSnapshot{
		Nodes: []game.StarNode{
			{ID: 1, X: 10, Y: 10, Name: "A", Size: "sm", Tint: "#000"},
			{ID: 2, X: 20, Y: 20, Name: "B", Size: "sm", Tint: "#000"},
			{ID: 3, X: 30, Y: 10, Name: "C", Size: "sm", Tint: "#000"},
		},
		Edges: []game.StarEdge{
			{From: 1, To: 2},
			{From: 2, To: 3},
			{From: 1, To: 3},
		},
	}
}

// createTestPlayer 创建一个测试玩家并返回其 UUID（pgtype.UUID）。
// role 通常为 "player" 或 "admin"。t.Cleanup 会删除该玩家及其地图。
func createTestPlayer(t *testing.T, pool *pgxpool.Pool, queries *db.Queries, role string) (pgtype.UUID, *auth.JWTPayload) {
	t.Helper()
	ctx := context.Background()
	pID := uuid.New()
	pgID := pgtype.UUID{Bytes: pID, Valid: true}
	displayName := "p3test-" + pID.String()[:8]

	_, err := queries.CreatePlayer(ctx, db.CreatePlayerParams{
		ID:          pgID,
		UserID:      "p3test-" + pID.String()[:8],
		DisplayName: displayName,
		Role:        role,
		Password:    nil,
		Avatar:      0,
	})
	if err != nil {
		t.Fatalf("创建测试玩家失败: %v", err)
	}

	t.Cleanup(func() {
		// 先删地图（避免 ON DELETE SET NULL 干扰）
		_, _ = pool.Exec(ctx, "DELETE FROM maps WHERE created_by = $1", pgID)
		// 再删玩家（CASCADE 清理 custom_match_queues/custom_match_queue_players）
		_ = queries.DeletePlayer(ctx, pgID)
	})

	payload := &auth.JWTPayload{
		PlayerID:    pID.String(),
		UserID:      "p3test-" + pID.String()[:8],
		Role:        role,
		DisplayName: displayName,
	}
	return pgID, payload
}

// newAuthRequest 构造带 auth 上下文的 httptest.Request。
func newAuthRequest(method, path, body string, payload *auth.JWTPayload) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if payload != nil {
		req = req.WithContext(context.WithValue(req.Context(), AuthPayloadKey, payload))
	}
	return req
}

// TestCreateMap_AdminOfficial 验证 admin POST 创建官方地图：
//   - 返回 201
//   - 响应 isOfficial=true
//   - slug 可设
//
// 注意：DB 有 one_admin_only 唯一约束，因此复用已存在的 admin 玩家（GetPlayerByRole）。
// 测试创建的地图通过 t.Cleanup 删除（按 slug 精确匹配）。
// slug 使用 UUID 后缀避免与历史测试残留数据冲突。
func TestCreateMap_AdminOfficial(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)

	ctx := context.Background()
	admin, err := queries.GetPlayerByRole(ctx, "admin")
	if err != nil {
		t.Skipf("测试 DB 无 admin 玩家，跳过: %v", err)
	}
	adminPayload := &auth.JWTPayload{
		PlayerID:    uuid.UUID(admin.ID.Bytes).String(),
		UserID:      admin.UserID,
		Role:        admin.Role,
		DisplayName: admin.DisplayName,
	}
	slug := "p3test-admin-slug-" + uuid.NewString()[:8]
	// 预清理：删除可能残留的同 slug 记录（理论上不应存在，但保证幂等）
	if _, err := pool.Exec(ctx, "DELETE FROM maps WHERE slug = $1", slug); err != nil {
		t.Fatalf("预清理 slug 失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM maps WHERE slug = $1", slug)
	})

	layout := validTestLayout()
	layoutBytes, _ := json.Marshal(layout)
	body := `{"name":"p3test-admin-map","description":"admin test","slug":"` + slug + `","layoutJson":` + string(layoutBytes) + `}`

	req := newAuthRequest(http.MethodPost, "/api/maps", body, adminPayload)
	rec := httptest.NewRecorder()
	handler.CreateMap(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("期望 201, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp mapResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("解析响应失败: %v, body=%s", err, rec.Body.String())
	}
	if !resp.IsOfficial {
		t.Errorf("期望 isOfficial=true, 实际 false")
	}
	if resp.Slug == nil || *resp.Slug != slug {
		t.Errorf("期望 slug=%s, 实际 %v", slug, resp.Slug)
	}
}

// TestCreateMap_UserNonOfficial 验证普通用户 POST 创建个人地图：
//   - 返回 201
//   - 响应 isOfficial=false
//   - slug 强制 NULL（即使请求体传了 slug）
func TestCreateMap_UserNonOfficial(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)
	_, userPayload := createTestPlayer(t, pool, queries, "player")

	layout := validTestLayout()
	layoutBytes, _ := json.Marshal(layout)
	body := `{"name":"p3test-user-map","slug":"should-be-ignored","layoutJson":` + string(layoutBytes) + `}`

	req := newAuthRequest(http.MethodPost, "/api/maps", body, userPayload)
	rec := httptest.NewRecorder()
	handler.CreateMap(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("期望 201, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
	var resp mapResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("解析响应失败: %v, body=%s", err, rec.Body.String())
	}
	if resp.IsOfficial {
		t.Errorf("期望 isOfficial=false, 实际 true")
	}
	if resp.Slug != nil {
		t.Errorf("期望 slug=nil（普通用户强制 NULL）, 实际 %v", *resp.Slug)
	}
}

// TestCreateMap_QuotaExceeded 验证普通用户上传配额：
//   - 先插入 10 条 is_official=false, created_by=同用户的地图
//   - 第 11 次上传返回 429
func TestCreateMap_QuotaExceeded(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)
	pgUserID, userPayload := createTestPlayer(t, pool, queries, "player")

	ctx := context.Background()
	// 预插入 10 条个人地图（直接 SQL 更快）
	layoutJSON := `{"nodes":[{"id":1,"x":10,"y":10,"name":"A","size":"sm","tint":"#000"},{"id":2,"x":20,"y":20,"name":"B","size":"sm","tint":"#000"},{"id":3,"x":30,"y":10,"name":"C","size":"sm","tint":"#000"}],"edges":[{"from":1,"to":2},{"from":2,"to":3},{"from":1,"to":3}]}`
	for i := 0; i < 10; i++ {
		_, err := queries.CreateMap(ctx, db.CreateMapParams{
			ID:         pgtype.UUID{Bytes: uuid.New(), Valid: true},
			Name:       "p3test-quota-" + uuid.NewString()[:8],
			IsOfficial: false,
			CreatedBy:  pgUserID,
			Version:    1,
			LayoutJson: []byte(layoutJSON),
		})
		if err != nil {
			t.Fatalf("预插入第 %d 条地图失败: %v", i+1, err)
		}
	}

	// 第 11 次上传应返回 429
	layout := validTestLayout()
	layoutBytes, _ := json.Marshal(layout)
	body := `{"name":"p3test-quota-exceed","layoutJson":` + string(layoutBytes) + `}`

	req := newAuthRequest(http.MethodPost, "/api/maps", body, userPayload)
	rec := httptest.NewRecorder()
	handler.CreateMap(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("期望 429, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "10 张/用户") {
		t.Errorf("期望错误信息含 '10 张/用户', 实际 body=%s", rec.Body.String())
	}
}

// TestCreateMap_SensitiveName 验证 name 含敏感词返回 400。
// 此路径在 DB 调用之前，无需真实 DB；但为保持测试一致性仍连接 DB。
func TestCreateMap_SensitiveName(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)
	_, userPayload := createTestPlayer(t, pool, queries, "player")

	layout := validTestLayout()
	layoutBytes, _ := json.Marshal(layout)
	body := `{"name":"badword玩家","layoutJson":` + string(layoutBytes) + `}`

	req := newAuthRequest(http.MethodPost, "/api/maps", body, userPayload)
	rec := httptest.NewRecorder()
	handler.CreateMap(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("期望 400, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "违规内容") {
		t.Errorf("期望错误信息含 '违规内容', 实际 body=%s", rec.Body.String())
	}
}

// TestDeleteMap_WaitingRoomBlock 验证被 waiting 状态的 custom_match_queues
// 引用的地图不可删除（409）。
func TestDeleteMap_WaitingRoomBlock(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)
	pgUserID, userPayload := createTestPlayer(t, pool, queries, "player")

	ctx := context.Background()
	// 创建一张个人地图
	pgMapID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	layoutJSON := `{"nodes":[{"id":1,"x":10,"y":10,"name":"A","size":"sm","tint":"#000"},{"id":2,"x":20,"y":20,"name":"B","size":"sm","tint":"#000"},{"id":3,"x":30,"y":10,"name":"C","size":"sm","tint":"#000"}],"edges":[{"from":1,"to":2},{"from":2,"to":3},{"from":1,"to":3}]}`
	_, err := queries.CreateMap(ctx, db.CreateMapParams{
		ID:         pgMapID,
		Name:       "p3test-waiting-block",
		IsOfficial: false,
		CreatedBy:  pgUserID,
		Version:    1,
		LayoutJson: []byte(layoutJSON),
	})
	if err != nil {
		t.Fatalf("创建测试地图失败: %v", err)
	}

	// 插入一条 status='waiting' 的 custom_match_queues 引用该地图
	queueUUID := uuid.New()
	_, err = pool.Exec(ctx,
		`INSERT INTO custom_match_queues (id, queue_id, queue_name, creator_id, max_players, min_players, status, map_id)
		 VALUES ($1, $2, $3, $4, 4, 3, 'waiting', $5)`,
		queueUUID, "p3test-queue-"+queueUUID.String()[:8], "p3test-waiting-queue", pgUserID, pgMapID)
	if err != nil {
		t.Fatalf("插入 waiting 队列失败: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM custom_match_queues WHERE id = $1", queueUUID)
	})

	// 删除地图应被阻止（409）
	// 注意：httptest.NewRequest 不经过 mux 路由，r.PathValue("id") 返回空串。
	// 用 SetPathValue 显式注入路径参数，模拟路由匹配效果。
	mapIDStr := uuid.UUID(pgMapID.Bytes).String()
	req := newAuthRequest(http.MethodDelete, "/api/maps/"+mapIDStr, "", userPayload)
	req.SetPathValue("id", mapIDStr)
	rec := httptest.NewRecorder()
	handler.DeleteMap(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("期望 409, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "waiting") {
		t.Errorf("期望错误信息含 'waiting', 实际 body=%s", rec.Body.String())
	}
}

// TestListMyMaps 验证 GET /api/maps/mine 列出当前用户上传的个人地图：
//   - 用户 A POST 创建一张 is_official=false 的个人地图
//   - ListMyMaps 返回数组长度 >= 1，含该地图 id，且 isOfficial=false
//   - 用户 B 的地图不应出现在用户 A 的列表中（owner 过滤）
func TestListMyMaps(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)
	_, userAPayload := createTestPlayer(t, pool, queries, "player")

	// 用户 A 上传一张个人地图（is_official=false）
	layout := validTestLayout()
	layoutBytes, _ := json.Marshal(layout)
	createReq := newAuthRequest(http.MethodPost, "/api/maps", `{"name":"p3test-my-map","layoutJson":`+string(layoutBytes)+`}`, userAPayload)
	createRec := httptest.NewRecorder()
	handler.CreateMap(createRec, createReq)
	if createRec.Code != http.StatusCreated {
		t.Fatalf("期望 201, 实际 %d, body=%s", createRec.Code, createRec.Body.String())
	}
	var created mapResponse
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("解析创建响应失败: %v, body=%s", err, createRec.Body.String())
	}
	if created.IsOfficial {
		t.Fatalf("期望个人地图 isOfficial=false, 实际 true")
	}

	// 用户 B 也上传一张个人地图，不应出现在用户 A 的列表中
	_, userBPayload := createTestPlayer(t, pool, queries, "player")
	createReqB := newAuthRequest(http.MethodPost, "/api/maps", `{"name":"p3test-other-map","layoutJson":`+string(layoutBytes)+`}`, userBPayload)
	createRecB := httptest.NewRecorder()
	handler.CreateMap(createRecB, createReqB)
	if createRecB.Code != http.StatusCreated {
		t.Fatalf("用户 B 创建地图期望 201, 实际 %d, body=%s", createRecB.Code, createRecB.Body.String())
	}
	var createdB mapResponse
	if err := json.NewDecoder(createRecB.Body).Decode(&createdB); err != nil {
		t.Fatalf("解析用户 B 创建响应失败: %v, body=%s", err, createRecB.Body.String())
	}

	// 用户 A 调 ListMyMaps
	listReq := newAuthRequest(http.MethodGet, "/api/maps/mine", "", userAPayload)
	listRec := httptest.NewRecorder()
	handler.ListMyMaps(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("期望 200, 实际 %d, body=%s", listRec.Code, listRec.Body.String())
	}

	var maps []mapResponse
	if err := json.NewDecoder(listRec.Body).Decode(&maps); err != nil {
		t.Fatalf("解析列表响应失败: %v, body=%s", err, listRec.Body.String())
	}
	if len(maps) < 1 {
		t.Fatalf("期望列表长度 >= 1, 实际 %d", len(maps))
	}

	found := false
	for _, m := range maps {
		if m.ID == created.ID {
			found = true
			if m.IsOfficial {
				t.Errorf("列表中的地图期望 isOfficial=false, 实际 true")
			}
		}
		if m.ID == createdB.ID {
			t.Errorf("用户 B 的地图不应出现在用户 A 的列表中")
		}
	}
	if !found {
		t.Errorf("期望列表包含刚创建的地图 id=%s, 实际 %+v", created.ID, maps)
	}
}

// TestListMyMaps_Unauthorized 验证未认证请求 GET /api/maps/mine 返回 401。
func TestListMyMaps_Unauthorized(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)

	req := newAuthRequest(http.MethodGet, "/api/maps/mine", "", nil)
	rec := httptest.NewRecorder()
	handler.ListMyMaps(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("期望 401, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
}

// TestDeleteMap_OwnershipForbidden 验证用户 B 删除用户 A 上传的地图返回 403。
func TestDeleteMap_OwnershipForbidden(t *testing.T) {
	pool := setupMapHandlerTestDB(t)
	defer pool.Close()
	queries := db.New(pool)
	handler := NewMapHandler(queries)

	pgOwnerID, _ := createTestPlayer(t, pool, queries, "player")
	_, intruderPayload := createTestPlayer(t, pool, queries, "player")

	ctx := context.Background()
	// 用户 A 上传地图
	pgMapID := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	layoutJSON := `{"nodes":[{"id":1,"x":10,"y":10,"name":"A","size":"sm","tint":"#000"},{"id":2,"x":20,"y":20,"name":"B","size":"sm","tint":"#000"},{"id":3,"x":30,"y":10,"name":"C","size":"sm","tint":"#000"}],"edges":[{"from":1,"to":2},{"from":2,"to":3},{"from":1,"to":3}]}`
	_, err := queries.CreateMap(ctx, db.CreateMapParams{
		ID:         pgMapID,
		Name:       "p3test-ownership-owner",
		IsOfficial: false,
		CreatedBy:  pgOwnerID,
		Version:    1,
		LayoutJson: []byte(layoutJSON),
	})
	if err != nil {
		t.Fatalf("创建测试地图失败: %v", err)
	}

	// 用户 B 尝试删除 → 403
	// 注意：httptest.NewRequest 不经过 mux 路由，r.PathValue("id") 返回空串。
	// 用 SetPathValue 显式注入路径参数，模拟路由匹配效果。
	mapIDStr := uuid.UUID(pgMapID.Bytes).String()
	req := newAuthRequest(http.MethodDelete, "/api/maps/"+mapIDStr, "", intruderPayload)
	req.SetPathValue("id", mapIDStr)
	rec := httptest.NewRecorder()
	handler.DeleteMap(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("期望 403, 实际 %d, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "无权删除他人地图") {
		t.Errorf("期望错误信息含 '无权删除他人地图', 实际 body=%s", rec.Body.String())
	}
}
