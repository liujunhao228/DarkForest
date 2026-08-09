package integration

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"darkforest/mcpserver/internal/persistence"
)

// --- 通用 map 取值辅助 ---

func str(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

func intVal(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

func boolVal(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, _ := m[key].(bool)
	return v
}

// --- 事件解析辅助(wait_for_event 输出的结构化事件) ---

// eventPayloads 从 wait_for_event 输出的 events 数组中提取指定 type 的 payload 列表。
func eventPayloads(t *testing.T, out map[string]any, wantType string) []map[string]any {
	t.Helper()
	evs, _ := out["events"].([]any)
	var hits []map[string]any
	for _, e := range evs {
		em, ok := e.(map[string]any)
		if !ok {
			continue
		}
		typ, _ := em["type"].(string)
		if typ != wantType {
			continue
		}
		if p, ok := em["payload"].(map[string]any); ok {
			hits = append(hits, p)
		} else {
			hits = append(hits, nil)
		}
	}
	return hits
}

// fullSyncView 从事件输出提取最后一个 fullSync 的 ViewState map。
func fullSyncView(t *testing.T, out map[string]any) (map[string]any, bool) {
	t.Helper()
	evs, _ := out["events"].([]any)
	for i := len(evs) - 1; i >= 0; i-- {
		em, ok := evs[i].(map[string]any)
		if !ok {
			continue
		}
		typ, _ := em["type"].(string)
		if typ != "game:fullSync" {
			continue
		}
		payload, ok := em["payload"].(map[string]any)
		if !ok {
			continue
		}
		state, ok := payload["state"].(map[string]any)
		if !ok {
			continue
		}
		return state, true
	}
	return nil, false
}

// waitForEventType 循环 wait_for_event 直到出现指定类型事件或超时,返回其首个 payload。
func waitForEventType(t *testing.T, d *agentDriver, wantType string, timeout time.Duration) map[string]any {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		sec := int(time.Until(deadline).Seconds())
		if sec < 1 {
			sec = 1
		}
		if sec > 30 {
			sec = 30
		}
		out := d.waitEvent(sec)
		if payloads := eventPayloads(t, out, wantType); len(payloads) > 0 {
			return payloads[0]
		}
	}
	t.Fatalf("等待事件 %q 超时(%v)", wantType, timeout)
	return nil
}

// --- trust 环境(子进程 + 两个 agent 会话) ---

type trustEnv struct {
	t           *testing.T
	backendCmd  *exec.Cmd
	mcpCmd      *exec.Cmd
	backendPort int
	mcpPort     int
	dbPath      string
	driverA     *agentDriver
	driverB     *agentDriver
}

// stop 显式终止 backend 与 mcpserver 子进程树(含整棵进程树)。
// 用于确定性两遍运行之间隔离,避免 run1 的 backend 仍把玩家视为在线/在局
// 以致 run2 匹配超时(t.Cleanup 仅在测试结束才触发,不足以在两遍之间隔离)。
func (env *trustEnv) stop() {
	if env.backendCmd != nil {
		killTreeCmd(env.backendCmd)
		env.backendCmd = nil
	}
	if env.mcpCmd != nil {
		killTreeCmd(env.mcpCmd)
		env.mcpCmd = nil
	}
}

// startTrustEnv 起 trust backend + mcpserver,建立两个独立 MCP 会话。
// 任一环节缺 DB / 失败都会 t.Fatal 或 t.Skip(由 trustBackendEnv 内 requireDB 控制)。
func startTrustEnv(t *testing.T) *trustEnv {
	backendPort, err := pickFreePort("127.0.0.1")
	if err != nil {
		t.Fatalf("pickFreePort 失败: %v", err)
	}
	mcpPort, err := pickFreePort("127.0.0.1")
	if err != nil {
		t.Fatalf("pickFreePort 失败: %v", err)
	}

	logW := io.Discard
	if os.Getenv("TRUST_E2E_VERBOSE") == "1" {
		logW = os.Stdout
	}

	backendEnv := trustBackendEnv(t, backendPort)
	backendCmd, backendPort := spawnBackend(t, backendEnv, logW)

	dbPath := filepath.Join(t.TempDir(), "mcps.db")
	mcpEnv := mcpserverEnv(mcpPort, backendPort, dbPath)
	mcpCmd, mcpPort := spawnMcpserver(t, mcpEnv, logW)

	waitHealth(t, healthURL(backendPort, "api/health"), 90*time.Second)
	waitHealth(t, healthURL(mcpPort, "health"), 30*time.Second)

	mcpURL := fmt.Sprintf("http://127.0.0.1:%d/mcp", mcpPort)
	env := &trustEnv{
		t: t, backendPort: backendPort, mcpPort: mcpPort, dbPath: dbPath,
		backendCmd: backendCmd, mcpCmd: mcpCmd,
	}
	env.driverA = newAgentDriver(t, mcpURL)
	env.driverB = newAgentDriver(t, mcpURL)
	return env
}

// waitFullSync 等待下一个 fullSync 事件并返回其 ViewState。
func (env *trustEnv) waitFullSync(d *agentDriver, timeout time.Duration) map[string]any {
	t := env.t
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		sec := int(time.Until(deadline).Seconds())
		if sec < 1 {
			sec = 1
		}
		if sec > 30 {
			sec = 30
		}
		out := d.waitEvent(sec)
		if vs, ok := fullSyncView(t, out); ok {
			return vs
		}
	}
	t.Fatalf("等待 fullSync 超时(%v)", timeout)
	return nil
}

// waitFullSyncUntilPhase 等待 fullSync 且 phase==want,返回该 ViewState。
func (env *trustEnv) waitFullSyncUntilPhase(d *agentDriver, phase string, timeout time.Duration) map[string]any {
	t := env.t
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		sec := int(time.Until(deadline).Seconds())
		if sec < 1 {
			sec = 1
		}
		if sec > 30 {
			sec = 30
		}
		out := d.waitEvent(sec)
		if vs, ok := fullSyncView(t, out); ok && str(vs, "phase") == phase {
			return vs
		}
	}
	t.Fatalf("等待 fullSync(phase=%q) 超时(%v)", phase, timeout)
	return nil
}

// sweepPending 防御性清扫 pendingAction(广播类)。正常 harness 不主动发广播,
// 此函数仅在 end_turn 被 pending 阻塞时兜底,避免死循环。
func (env *trustEnv) sweepPending(d *agentDriver, vs map[string]any) {
	t := env.t
	t.Helper()
	pa, ok := vs["pendingAction"].(map[string]any)
	if !ok {
		return
	}
	switch str(pa, "type") {
	case "respondBroadcast":
		d.respondBroadcast(false, "")
	case "selectBroadcastResponder":
		var responders []string
		if ra, ok := pa["responders"].([]any); ok {
			for _, r := range ra {
				if s, ok := r.(string); ok {
					responders = append(responders, s)
				}
			}
		}
		if len(responders) == 0 {
			// 退路:从 broadcastState 读广播者本人(发起者不能选自己,取任意对手)
			responders = env.otherPlayerIDs(vs)
		}
		if len(responders) > 0 {
			d.selectBroadcastResponder(responders[0])
		}
	default:
		t.Logf("遇到未处理的 pendingAction type=%q,忽略", str(pa, "type"))
	}
}

// otherPlayerIDs 返回 fullSync 中除 localPlayerId 外的玩家 ID 列表。
func (env *trustEnv) otherPlayerIDs(vs map[string]any) []string {
	local := str(vs, "localPlayerId")
	var out []string
	players, _ := vs["players"].([]any)
	for _, p := range players {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if id := str(pm, "id"); id != "" && id != local {
			out = append(out, id)
		}
	}
	return out
}

// localHandDefIDs 从 fullSync ViewState 提取本地玩家(与 playerID 匹配)手牌 defIds。
func localHandDefIDs(t *testing.T, vs map[string]any, playerID string) []string {
	t.Helper()
	players, _ := vs["players"].([]any)
	for _, p := range players {
		pm, ok := p.(map[string]any)
		if !ok || str(pm, "id") != playerID {
			continue
		}
		hand, _ := pm["hand"].([]any)
		ids := make([]string, 0, len(hand))
		for _, c := range hand {
			cm, ok := c.(map[string]any)
			if !ok {
				continue
			}
			if id := str(cm, "defId"); id != "" {
				ids = append(ids, id)
			}
		}
		return ids
	}
	return nil
}

// --- 全链路一次运行 ---

// loopResult 记录一次 trust 全链路运行的观察结果。
type loopResult struct {
	playerA    string
	playerB    string
	handA      []string // A 初始手牌 defIds
	handB      []string // B 初始手牌 defIds
	replayID   string
	matchID    string
	totalTurns int
	winner     string
}

// runTrustLoop 执行一次完整 trust 全链路:
// 起两端 → 双 agent 匹配 → 对打 3 回合 → forfeit 结算 → 回放落库 → 语义视图 → DB 直读。
func runTrustLoop(t *testing.T) *loopResult {
	t.Helper()
	env := startTrustEnv(t)
	res := &loopResult{}

	// 1. 工具清单断言(含本批新增 forfeit_game)
	assertToolsContain(t, env.driverA, "forfeit_game")

	// 2. ensure_connected ×2
	outA := env.driverA.ensureConnected()
	outB := env.driverB.ensureConnected()
	res.playerA = str(outA, "playerId")
	res.playerB = str(outB, "playerId")
	if res.playerA == "" || res.playerB == "" || res.playerA == res.playerB {
		t.Fatalf("ensure_connected 未返回有效 PlayerID: A=%v B=%v", outA, outB)
	}
	t.Logf("agent A=%s(%s) B=%s(%s)", str(outA, "accountId"), res.playerA, str(outB, "accountId"), res.playerB)

	// 3. join_match_queue ×2
	env.driverA.joinQueue(2)
	env.driverB.joinQueue(2)

	// 4. 等 match:found,断言双方 roomId 一致
	ma := waitForEventType(t, env.driverA, "match:found", 60*time.Second)
	mb := waitForEventType(t, env.driverB, "match:found", 60*time.Second)
	roomA, roomB := str(ma, "roomId"), str(mb, "roomId")
	if roomA == "" || roomA != roomB {
		t.Fatalf("双方 match:found roomId 不一致: A=%q B=%q", roomA, roomB)
	}

	// 5. 收集双方初始手牌(首个 fullSync)
	vsA := env.waitFullSync(env.driverA, 30*time.Second)
	res.handA = localHandDefIDs(t, vsA, res.playerA)
	vsB := env.waitFullSync(env.driverB, 30*time.Second)
	res.handB = localHandDefIDs(t, vsB, res.playerB)
	if len(res.handA) == 0 || len(res.handB) == 0 {
		t.Fatalf("初始手牌为空: A=%v B=%v", res.handA, res.handB)
	}

	// 6. 对打 3 回合(轮转当前玩家 end_turn)
	lastVS := vsB
	totalTurn := 0
	for guard := 0; totalTurn < 3; guard++ {
		if guard > 60 {
			t.Fatalf("对打超过 60 次动作仍未达到 3 回合(totalTurn=%d)", totalTurn)
		}
		cur := str(lastVS, "currentPlayerId")
		var d *agentDriver
		switch cur {
		case res.playerA:
			d = env.driverA
		case res.playerB:
			d = env.driverB
		default:
			// currentPlayerId 未就绪,消化一个事件再试
			if v, ok := fullSyncView(t, env.driverA.waitEvent(5)); ok {
				lastVS = v
			}
			continue
		}
		out := d.endTurn()
		if !boolVal(out, "success") {
			// pending 阻塞:读事件后清扫重试
			if v, ok := fullSyncView(t, d.waitEvent(5)); ok {
				lastVS = v
				env.sweepPending(d, lastVS)
			}
			continue
		}
		if v, ok := fullSyncView(t, d.waitEvent(20)); ok {
			lastVS = v
			totalTurn = intVal(lastVS, "totalTurn")
		}
	}
	t.Logf("对打完成,totalTurn=%d", totalTurn)
	if totalTurn < 3 {
		t.Fatalf("totalTurn=%d < 3", totalTurn)
	}

	// 7. forfeit 结算:当前玩家弃权 → 双方 gameOver
	cur := str(lastVS, "currentPlayerId")
	var forfeiter *agentDriver
	switch cur {
	case res.playerA:
		forfeiter = env.driverA
	default:
		forfeiter = env.driverB
	}
	if out := forfeiter.forfeit(); !boolVal(out, "success") {
		t.Fatalf("forfeit_game 失败: %v", out)
	}
	gvA := env.waitFullSyncUntilPhase(env.driverA, "gameOver", 30*time.Second)
	gvB := env.waitFullSyncUntilPhase(env.driverB, "gameOver", 30*time.Second)
	res.winner = str(gvA, "winner")
	if res.winner == "" {
		t.Fatalf("gameOver 但 winner 为空(A=%v B=%v)", gvA, gvB)
	}
	if str(gvA, "winner") != str(gvB, "winner") {
		t.Fatalf("双方 winner 不一致: A=%q B=%q", str(gvA, "winner"), str(gvB, "winner"))
	}
	t.Logf("结算完成: winner=%s", res.winner)

	// 8. fetch_and_save_replay ×2(matchId 一致)
	fa := env.driverA.fetchSaveReplay()
	fb := env.driverB.fetchSaveReplay()
	if !boolVal(fa, "saved") || !boolVal(fb, "saved") {
		t.Fatalf("fetch_and_save_replay 未全部 saved: A=%v B=%v", fa, fb)
	}
	res.replayID = str(fa, "replayId")
	res.matchID = str(fa, "matchId")
	if res.replayID == "" || res.matchID == "" {
		t.Fatalf("回放 ID/MatchID 为空: A=%v", fa)
	}
	if str(fb, "matchId") != res.matchID {
		t.Fatalf("双方 fetch 到的 matchId 不一致: A=%q B=%q", res.matchID, str(fb, "matchId"))
	}

	// 9. list_local_replays:含同一行,winner/totalTurns>0
	lr := env.driverA.listLocalReplays()
	replays, _ := lr["replays"].([]any)
	listed := false
	for _, r := range replays {
		rm, ok := r.(map[string]any)
		if !ok || str(rm, "id") != res.replayID {
			continue
		}
		listed = true
		if intVal(rm, "totalTurns") <= 0 || str(rm, "winner") == "" {
			t.Fatalf("本地回放行缺 winner/totalTurns: %v", rm)
		}
	}
	if !listed {
		t.Fatalf("list_local_replays 缺少 %q: %v", res.replayID, lr)
	}

	// 10. 会话 B fetch_shared_replay(A 的行 id) → 证明互读
	if fs := env.driverB.fetchSharedReplay(res.replayID); !boolVal(fs, "saved") {
		t.Fatalf("fetch_shared_replay 失败: %v", fs)
	}

	// 11. get_replay_semantic_view{turn:1} → Found,OmniscientView.Players=2
	sv := env.driverA.getSemanticView(res.replayID, 1)
	if !boolVal(sv, "found") {
		t.Fatalf("get_replay_semantic_view not found: %v", sv)
	}
	ov, ok := sv["omniscientView"].(map[string]any)
	if !ok {
		t.Fatalf("semantic view 缺 omniscientView: %v", sv)
	}
	players, _ := ov["players"].([]any)
	if len(players) != 2 {
		t.Fatalf("semantic view players=%d, want 2", len(players))
	}

	// 12. get_my_profile ×2:role=player 且 totalMatches≥1
	pa := env.driverA.getProfile()
	pb := env.driverB.getProfile()
	if str(pa, "role") != "player" || str(pb, "role") != "player" {
		t.Fatalf("get_my_profile role != player: A=%v B=%v", pa, pb)
	}
	if intVal(pa, "totalMatches") < 1 || intVal(pb, "totalMatches") < 1 {
		t.Fatalf("get_my_profile totalMatches < 1: A=%v B=%v", pa, pb)
	}

	// 13. 直接打开 mcpserver.db(persistence.Open)读回同一行(弯刀断言)
	db, err := persistence.Open(env.dbPath)
	if err != nil {
		t.Fatalf("persistence.Open(%s) 失败: %v", env.dbPath, err)
	}
	rows, err := db.Replay.ListReplays(10, 0)
	db.Close()
	if err != nil {
		t.Fatalf("ListReplays 失败: %v", err)
	}
	direct := false
	for _, r := range rows {
		if r.ID == res.replayID {
			direct = true
			if r.TotalTurns <= 0 || r.Winner == "" {
				t.Fatalf("SQLite 直读行缺 winner/totalTurns: %+v", r)
			}
			res.totalTurns = r.TotalTurns
		}
	}
	if !direct {
		t.Fatalf("persistence.Open 直读缺少 %q", res.replayID)
	}

	t.Logf("全链路 PASS: match=%s replay=%s winner=%s turns=%d handA=%v handB=%v",
		res.matchID, res.replayID, res.winner, res.totalTurns, res.handA, res.handB)
	// 显式关停整组子进程,确保确定性两遍运行串行隔离(t.Cleanup 仅在测试结束触发)。
	env.stop()
	return res
}

// sameMultiset 比较两个字符串切片作为多重集是否相等(排序后逐元素)。
func sameMultiset(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa := append([]string(nil), a...)
	bb := append([]string(nil), b...)
	sort.Strings(aa)
	sort.Strings(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}

// --- 顶层测试 ---

// TestTrustUnifiedFullLoop 完整 trust 集成全链路(红→绿核心验收)。
// 门控:TRUST_E2E=1 且 DATABASE_URL 可达。
func TestTrustUnifiedFullLoop(t *testing.T) {
	if !trustEnabled() {
		t.Skip("TRUST_E2E!=1,跳过集成全链路(由 make trust-e2e / CI 设置)")
	}
	runTrustLoop(t)
}

// TestTrustUnifiedDeterminism 确定性:同 E2E_RAND_SEED=42 连续跑两遍,
// 两个 agent 首副手牌 defId 多重集逐会话一致。
func TestTrustUnifiedDeterminism(t *testing.T) {
	if !trustEnabled() {
		t.Skip("TRUST_E2E!=1,跳过确定性子测")
	}
	run1 := runTrustLoop(t)
	run2 := runTrustLoop(t)
	if !sameMultiset(run1.handA, run2.handA) || !sameMultiset(run1.handB, run2.handB) {
		t.Fatalf("两次运行初始手牌多重集不一致:\nrun1 A=%v B=%v\nrun2 A=%v B=%v",
			run1.handA, run1.handB, run2.handA, run2.handB)
	}
	t.Logf("确定性 PASS: 两遍手牌多重集一致 A=%v B=%v", run1.handA, run1.handB)
}
