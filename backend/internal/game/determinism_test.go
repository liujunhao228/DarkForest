package game

import (
	"testing"
)

// TestNewGameDeterminismSameSeed 验证:在 E2E 确定性种子下,同一配置多次 NewGame
// 产生的初始手牌(及起始位置)完全一致,可跨运行复现。
// 复现手段:直接设置包内种子变量(绕过 init() 时序),等价于 E2E_RAND_SEED=42 + E2E_DETERMINISTIC_UID=1。
// 测试结束通过 t.Cleanup 还原全局状态,避免 e2eRandSeed 泄漏影响同包其他用例。
func TestNewGameDeterminismSameSeed(t *testing.T) {
	prevSeed := e2eRandSeed
	prevUID := e2eDeterministicUID
	prevRand := e2eRand
	t.Cleanup(func() {
		e2eRandSeed = prevSeed
		e2eDeterministicUID = prevUID
		e2eRand = prevRand
	})

	e2eRandSeed = 42
	e2eDeterministicUID = true
	seeds := []PlayerSeed{{ID: "e2e_1", Name: "alpha"}, {ID: "e2e_2", Name: "beta"}}
	var runs [][]string
	var positions []int
	for i := 0; i < 3; i++ {
		cfg := InitConfig{PlayerCount: 2, PlayerSeeds: seeds, GameMode: GameModeClassic}
		st := NewGame(cfg)
		var hand []string
		for _, c := range st.Players[0].Hand {
			hand = append(hand, c.DefID)
		}
		runs = append(runs, hand)
		positions = append(positions, st.Players[0].Position)
		t.Logf("run%d player0 hand=%v pos=%d", i+1, hand, st.Players[0].Position)
	}
	for i := 1; i < len(runs); i++ {
		for j := range runs[i] {
			if runs[i][j] != runs[0][j] {
				t.Fatalf("run%d hand 不一致: %v vs %v", i+1, runs[i], runs[0])
			}
		}
		if positions[i] != positions[0] {
			t.Fatalf("run%d 起始位置不一致: %d vs %d", i+1, positions[i], positions[0])
		}
	}
	t.Logf("PASS: 三跑手牌与起始位置一致")
}
