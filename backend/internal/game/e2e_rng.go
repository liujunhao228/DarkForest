package game

import (
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"sync/atomic"
)

// E2E 确定性测试钩子。与 backend/internal/api/rate_limit.go 中 DISABLE_RATE_LIMIT 模式一致：
// 通过环境变量守卫，仅在 E2E 测试场景生效，生产环境（不设变量）完全无副作用。
//
// 设计取舍：选择"种子化全局 RNG + 确定性 UID 计数器"组合方案，而非"注入式 RNG"。
// 原因：注入式 RNG 需要重构 GameState/NewGame/Shuffle 等多个调用点，改动面过大；
// 种子化方案只需在 NewGame 入口重置全局 rand 状态，对现有代码侵入最小。
//
// 详见 docs/designs/2026-08-02-deterministic-e2e-base-design.md。

var (
	// e2eRandSeed 从 E2E_RAND_SEED 解析得到，0=禁用（保持原随机行为）。
	e2eRandSeed int64
	// e2eDeterministicUID 在 E2E_DETERMINISTIC_UID=1 时为 true，使 GenerateID 改用单调计数器。
	e2eDeterministicUID bool
	// uidCounter 单调递增计数器，配合 e2eDeterministicUID 使用。
	uidCounter atomic.Uint64
)

func init() {
	// E2E_RAND_SEED：非空且能解析为正整数时启用种子化全局 RNG。
	if raw := os.Getenv("E2E_RAND_SEED"); raw != "" {
		if seed, err := strconv.ParseInt(raw, 10, 64); err == nil && seed > 0 {
			e2eRandSeed = seed
		}
	}
	// E2E_DETERMINISTIC_UID：值为 "1" 时启用确定性 UID 生成。
	if os.Getenv("E2E_DETERMINISTIC_UID") == "1" {
		e2eDeterministicUID = true
	}
}

// resetE2EStateIfNeeded 在每局 NewGame 入口调用，重置全局随机状态与 UID 计数器。
// 当 E2E_RAND_SEED=0 且 E2E_DETERMINISTIC_UID 未设时为 no-op，行为与生产完全一致。
//
// 注意：rand.Seed 在 Go 1.20+ 已标记 deprecated（详见 rand.Seed 文档），
// 但仍保留可用以支持对全局 rand 调用的种子化，无需重构 Shuffle 等调用点。
// 备选方案 rand.New(rand.NewSource(seed)) 需要把 *rand.Rand 透传到所有调用方，
// 改动面过大且超出本次"完善测试基座"的范围，故不采用。
func resetE2EStateIfNeeded() {
	if e2eRandSeed > 0 {
		rand.Seed(e2eRandSeed)
	}
	if e2eDeterministicUID {
		uidCounter.Store(0)
	}
}

// generateDeterministicID 返回形如 "e2e_<n>" 的单调递增 ID。
// 仅在 e2eDeterministicUID=true 时由 GenerateID 调用。
func generateDeterministicID() string {
	return fmt.Sprintf("e2e_%d", uidCounter.Add(1))
}
