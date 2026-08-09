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
// 设计取舍：以"专用可种子化 RNG（rand.New(rand.NewSource(seed))）+ 确定性 UID 计数器"组合实现
// 跨运行可复现，而非注入式 RNG（需透传 *rand.Rand 到所有调用方，改动面过大）。
// 关键修正：Go 1.20+ 顶层 rand.Seed 已是 no-op，无法重置全局 rand，故改在 NewGame 入口重建
// 独立可种子化源 e2eRand，并由 e2eIntn/e2eFloat64 在 E2E 模式下接管 Shuffle/遗迹分布等随机调用；
// 生产模式下 e2eRand 为 nil，这些辅助函数回落全局 rand，行为完全不变。
//
// 详见 docs/designs/2026-08-02-deterministic-e2e-base-design.md。

var (
	// e2eRandSeed 从 E2E_RAND_SEED 解析得到，0=禁用（保持原随机行为）。
	e2eRandSeed int64
	// e2eDeterministicUID 在 E2E_DETERMINISTIC_UID=1 时为 true，使 GenerateID 改用单调计数器。
	e2eDeterministicUID bool
	// uidCounter 单调递增计数器，配合 e2eDeterministicUID 使用。
	uidCounter atomic.Uint64
	// e2eRand 为 E2E 确定性模式下的专用随机数源；nil 表示生产模式（走全局 rand）。
	// 注意：Go 1.20+ 顶层 rand.Seed 已失效（no-op），故改用 rand.New(rand.NewSource(seed))
	// 重建独立可种子化源，否则每次 NewGame 的 Shuffle 仍走随机全局源，无法跨运行复现。
	e2eRand *rand.Rand
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
	// 每次 NewGame 重新读取 env(支持测试运行时 os.Setenv,而非仅依赖 init()),
	// 使确定性行为在单测与子进程两种场景下一致。生产环境(未设变量)保持全默认。
	if raw := os.Getenv("E2E_RAND_SEED"); raw != "" {
		if seed, err := strconv.ParseInt(raw, 10, 64); err == nil && seed > 0 {
			e2eRandSeed = seed
		}
	}
	if os.Getenv("E2E_DETERMINISTIC_UID") == "1" {
		e2eDeterministicUID = true
	}
	if e2eRandSeed > 0 {
		// Go 1.20+ 顶层 rand.Seed 已失效(no-op),改用独立可种子化源。
		// 每次 NewGame 重建,保证跨运行(含独立进程)可复现初始手牌。
		e2eRand = rand.New(rand.NewSource(e2eRandSeed))
	}
	if e2eDeterministicUID {
		uidCounter.Store(0)
	}
}

// e2eIntn 确定性感知的 [0,n) 随机整数。E2E 模式用 e2eRand,否则回落全局 rand(生产无副作用)。
func e2eIntn(n int) int {
	if e2eRand != nil {
		return e2eRand.Intn(n)
	}
	return rand.Intn(n)
}

// e2eFloat64 确定性感知的 [0,1) 浮点。E2E 模式用 e2eRand,否则回落全局 rand。
func e2eFloat64() float64 {
	if e2eRand != nil {
		return e2eRand.Float64()
	}
	return rand.Float64()
}

// generateDeterministicID 返回形如 "e2e_<n>" 的单调递增 ID。
// 仅在 e2eDeterministicUID=true 时由 GenerateID 调用。
func generateDeterministicID() string {
	return fmt.Sprintf("e2e_%d", uidCounter.Add(1))
}
