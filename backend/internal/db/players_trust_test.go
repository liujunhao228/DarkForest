package db

import (
	"context"
	"sync"
	"testing"
)

// TestGetOrCreatePlayerByUserID 验证 P1 LOCAL_TRUST_MODE 使用的 upsert 查询语义。
func TestGetOrCreatePlayerByUserID(t *testing.T) {
	pool := setupMigrationTestDB(t)
	ctx := context.Background()
	queries := New(pool)

	// 公共 cleanup：删除本测试可能创建的所有行
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, "DELETE FROM players WHERE user_id LIKE 'qq:test_%'")
	})

	// 预清理（防止前次残留）
	_, _ = pool.Exec(ctx, "DELETE FROM players WHERE user_id LIKE 'qq:test_%'")

	t.Run("new user_id inserts row", func(t *testing.T) {
		player, err := queries.GetOrCreatePlayerByUserID(ctx, GetOrCreatePlayerByUserIDParams{
			UserID:      "qq:test_new_1",
			DisplayName: "First",
		})
		if err != nil {
			t.Fatalf("GetOrCreatePlayerByUserID 失败: %v", err)
		}
		if player.UserID != "qq:test_new_1" {
			t.Errorf("UserID 期望 qq:test_new_1，实际 %s", player.UserID)
		}
		if player.DisplayName != "First" {
			t.Errorf("DisplayName 期望 First，实际 %s", player.DisplayName)
		}
		if player.Role != "player" {
			t.Errorf("Role 期望 player，实际 %s", player.Role)
		}
		if player.Wins != 0 || player.Losses != 0 || player.Draws != 0 || player.TotalMatches != 0 {
			t.Errorf("统计字段应为 0: wins=%d losses=%d draws=%d total=%d",
				player.Wins, player.Losses, player.Draws, player.TotalMatches)
		}
		// ID 应非 nil（pgtype.UUID 的 Valid 字段为 true）
		if !player.ID.Valid {
			t.Error("PlayerID ID.Valid 应为 true")
		}
	})

	t.Run("existing user_id reuses ID and updates display_name", func(t *testing.T) {
		// 第一次插入
		first, err := queries.GetOrCreatePlayerByUserID(ctx, GetOrCreatePlayerByUserIDParams{
			UserID:      "qq:test_update_1",
			DisplayName: "First",
		})
		if err != nil {
			t.Fatalf("第一次 GetOrCreatePlayerByUserID 失败: %v", err)
		}

		// 第二次：同 user_id 不同 display_name
		second, err := queries.GetOrCreatePlayerByUserID(ctx, GetOrCreatePlayerByUserIDParams{
			UserID:      "qq:test_update_1",
			DisplayName: "Second",
		})
		if err != nil {
			t.Fatalf("第二次 GetOrCreatePlayerByUserID 失败: %v", err)
		}

		// ID 应相同
		if first.ID != second.ID {
			t.Errorf("同一 user_id 应复用 ID：first=%v second=%v", first.ID, second.ID)
		}
		// display_name 应更新
		if second.DisplayName != "Second" {
			t.Errorf("DisplayName 期望 Second，实际 %s", second.DisplayName)
		}
	})

	t.Run("concurrent same user_id no error", func(t *testing.T) {
		// 预确保行存在（避免所有 goroutine 都走 INSERT 路径的竞态）
		_, err := queries.GetOrCreatePlayerByUserID(ctx, GetOrCreatePlayerByUserIDParams{
			UserID:      "qq:test_concurrent",
			DisplayName: "Concurrent",
		})
		if err != nil {
			t.Fatalf("预插入失败: %v", err)
		}

		const n = 10
		var wg sync.WaitGroup
		errs := make([]error, n)
		wg.Add(n)
		for i := 0; i < n; i++ {
			go func(idx int) {
				defer wg.Done()
				_, errs[idx] = queries.GetOrCreatePlayerByUserID(ctx, GetOrCreatePlayerByUserIDParams{
					UserID:      "qq:test_concurrent",
					DisplayName: "Concurrent",
				})
			}(i)
		}
		wg.Wait()

		for i, err := range errs {
			if err != nil {
				t.Errorf("goroutine %d 返回 error: %v", i, err)
			}
		}
	})
}
