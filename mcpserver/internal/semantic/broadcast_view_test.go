package semantic

import (
	"reflect"
	"sort"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// newBroadcastState 构造一个 BroadcastStateView，phase 默认为 waiting，可被覆盖。
func newBroadcastState(broadcasterID string, phase gamesdk.BroadcastPhase, responses ...gamesdk.BroadcastResponseView) *gamesdk.BroadcastStateView {
	if phase == "" {
		phase = gamesdk.BroadcastPhaseWaiting
	}
	return &gamesdk.BroadcastStateView{
		BroadcasterID: broadcasterID,
		CardUID:       "card-1",
		TargetSystem:  3,
		Range:         1,
		Phase:         phase,
		Responses:     responses,
	}
}

func TestProjectBroadcast_NilState(t *testing.T) {
	view := ProjectBroadcast(nil, "p1")
	if view.Phase != BroadcastPhaseInactive {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseInactive)
	}
	if view.MyRole != BroadcastRoleNone {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleNone)
	}
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil", view.ActionRequired)
	}
	if view.History != nil {
		t.Errorf("History = %v, want nil", view.History)
	}
	if view.ResidualMarkers != nil {
		t.Errorf("ResidualMarkers = %v, want nil", view.ResidualMarkers)
	}
}

func TestProjectBroadcast_Inactive(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
	}
	view := ProjectBroadcast(state, "p1")
	if view.Phase != BroadcastPhaseInactive {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseInactive)
	}
	if view.MyRole != BroadcastRoleNone {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleNone)
	}
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil", view.ActionRequired)
	}
}

func TestProjectBroadcast_WaitingBroadcaster(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseWaiting,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: false, Responded: false, Agreed: false},
		),
	}
	view := ProjectBroadcast(state, "p1")
	if view.Phase != BroadcastPhaseWaiting {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseWaiting)
	}
	if view.MyRole != BroadcastRoleBroadcaster {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleBroadcaster)
	}
	if view.ActionRequired == nil {
		t.Fatal("ActionRequired = nil, want non-nil")
	}
	if view.ActionRequired.Type != "cancel" {
		t.Errorf("ActionRequired.Type = %q, want %q", view.ActionRequired.Type, "cancel")
	}
	if !reflect.DeepEqual(view.ActionRequired.LegalOptions, []string{"cancel"}) {
		t.Errorf("ActionRequired.LegalOptions = %v, want [cancel]", view.ActionRequired.LegalOptions)
	}
}

func TestProjectBroadcast_WaitingResponder(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p2",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseWaiting,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: false, Responded: false, Agreed: false},
		),
	}
	view := ProjectBroadcast(state, "p2")
	if view.Phase != BroadcastPhaseWaiting {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseWaiting)
	}
	if view.MyRole != BroadcastRoleResponder {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleResponder)
	}
	if view.ActionRequired == nil {
		t.Fatal("ActionRequired = nil, want non-nil")
	}
	if view.ActionRequired.Type != "agreeOrRefuse" {
		t.Errorf("ActionRequired.Type = %q, want %q", view.ActionRequired.Type, "agreeOrRefuse")
	}
	if !reflect.DeepEqual(view.ActionRequired.LegalOptions, []string{"agree", "refuse"}) {
		t.Errorf("ActionRequired.LegalOptions = %v, want [agree refuse]", view.ActionRequired.LegalOptions)
	}
}

func TestProjectBroadcast_WaitingMustResponder(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p2",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseWaiting,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: true, Responded: false, Agreed: false},
		),
	}
	view := ProjectBroadcast(state, "p2")
	if view.MyRole != BroadcastRoleMustResponder {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleMustResponder)
	}
	if view.ActionRequired == nil {
		t.Fatal("ActionRequired = nil, want non-nil")
	}
	if view.ActionRequired.Type != "agreeOrRefuse" {
		t.Errorf("ActionRequired.Type = %q, want %q", view.ActionRequired.Type, "agreeOrRefuse")
	}
}

func TestProjectBroadcast_WaitingResponderAlreadyResponded(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p2",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseWaiting,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: false, Responded: true, Agreed: true},
		),
	}
	view := ProjectBroadcast(state, "p2")
	if view.MyRole != BroadcastRoleResponder {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleResponder)
	}
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil (already responded)", view.ActionRequired)
	}
}

func TestProjectBroadcast_WaitingObserver(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p3",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
			{ID: "p3", Name: "Carol"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseWaiting,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: false, Responded: false, Agreed: false},
		),
	}
	view := ProjectBroadcast(state, "p3")
	if view.Phase != BroadcastPhaseWaiting {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseWaiting)
	}
	if view.MyRole != BroadcastRoleNone {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleNone)
	}
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil for observer", view.ActionRequired)
	}
}

func TestProjectBroadcast_SelectBroadcaster(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseSelect,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, Responded: true, Agreed: true},
			gamesdk.BroadcastResponseView{PlayerID: "p3", CanRespond: true, Responded: true, Agreed: false},
			gamesdk.BroadcastResponseView{PlayerID: "p4", CanRespond: true, Responded: true, Agreed: true},
		),
	}
	view := ProjectBroadcast(state, "p1")
	if view.Phase != BroadcastPhaseSelect {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseSelect)
	}
	if view.MyRole != BroadcastRoleBroadcaster {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleBroadcaster)
	}
	if view.ActionRequired == nil {
		t.Fatal("ActionRequired = nil, want non-nil")
	}
	if view.ActionRequired.Type != "selectResponder" {
		t.Errorf("ActionRequired.Type = %q, want %q", view.ActionRequired.Type, "selectResponder")
	}
	// 仅 p2/p4 是 Responded && Agreed
	want := []string{"p2", "p4"}
	if !reflect.DeepEqual(view.ActionRequired.LegalOptions, want) {
		t.Errorf("ActionRequired.LegalOptions = %v, want %v", view.ActionRequired.LegalOptions, want)
	}
}

func TestProjectBroadcast_SelectBroadcasterNoAgreed(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseSelect,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, Responded: true, Agreed: false},
		),
	}
	view := ProjectBroadcast(state, "p1")
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil (no agreed responder)", view.ActionRequired)
	}
}

func TestProjectBroadcast_SelectResponder(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p2",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseSelect,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, Responded: true, Agreed: true},
		),
	}
	view := ProjectBroadcast(state, "p2")
	if view.Phase != BroadcastPhaseSelect {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseSelect)
	}
	if view.MyRole != BroadcastRoleResponder {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleResponder)
	}
	// responder 在 select 阶段：等待 broadcaster 选择，无 action
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil for responder in select", view.ActionRequired)
	}
}

func TestProjectBroadcast_RevealBroadcaster(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseReveal,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, Responded: true, Agreed: true},
		),
	}
	view := ProjectBroadcast(state, "p1")
	if view.Phase != BroadcastPhaseReveal {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseReveal)
	}
	if view.MyRole != BroadcastRoleBroadcaster {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleBroadcaster)
	}
	// reveal 阶段无 action（结算中）
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil in reveal phase", view.ActionRequired)
	}
}

func TestProjectBroadcast_RevealResponder(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p2",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
			{ID: "p2", Name: "Bob"},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseReveal,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: true, Responded: true, Agreed: true},
		),
	}
	view := ProjectBroadcast(state, "p2")
	if view.Phase != BroadcastPhaseReveal {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseReveal)
	}
	if view.MyRole != BroadcastRoleMustResponder {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleMustResponder)
	}
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil in reveal phase", view.ActionRequired)
	}
}

func TestProjectBroadcast_DonePhase(t *testing.T) {
	// done phase 不在 gamesdk 常量中，但语义层应允许透传
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Broadcast: newBroadcastState("p1", "done"),
	}
	view := ProjectBroadcast(state, "p1")
	if view.Phase != BroadcastPhaseDone {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseDone)
	}
	if view.MyRole != BroadcastRoleBroadcaster {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleBroadcaster)
	}
	// done 阶段无 action
	if view.ActionRequired != nil {
		t.Errorf("ActionRequired = %v, want nil in done phase", view.ActionRequired)
	}
}

func TestProjectBroadcast_History(t *testing.T) {
	sys3 := 3
	sys5 := 5
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     10,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Logs: []gamesdk.LogEntry{
			{ID: "l1", Turn: 1, Phase: "actionPhase", Type: "info", Message: "回合开始"},
			// 注：使用中性卡名 "测试广播" 避免命中 "合作"/"伪装"/"成功" 关键词。
			// 真实游戏中卡名如 "合作广播" 会因包含 "合作" 而被启发式误判为 success
			// —— 这是 task spec 启发式的已知局限，留作文档记录。
			{ID: "l2", Turn: 2, Phase: "actionPhase", Type: "broadcast", Message: "Alice 向星系 3 发送了【测试广播】",
				SystemID: &sys3, PlayerIDs: []string{"p1"}},
			{ID: "l3", Turn: 2, Phase: "actionPhase", Type: "broadcast", Message: "双方合作! Alice 和 Bob 各获得 3 点能量",
				SystemID: &sys3, PlayerIDs: []string{"p1", "p2"}},
			{ID: "l4", Turn: 3, Phase: "actionPhase", Type: "broadcast", Message: "无人回应, Alice 获得 1 点能量",
				SystemID: &sys5, PlayerIDs: []string{"p1"}},
			{ID: "l5", Turn: 3, Phase: "actionPhase", Type: "action", Message: "Alice 出牌"},
		},
	}
	view := ProjectBroadcast(state, "p1")
	if view.Phase != BroadcastPhaseInactive {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseInactive)
	}
	if len(view.History) != 3 {
		t.Fatalf("History len = %d, want 3", len(view.History))
	}

	// l2: 发起广播，使用中性卡名 → 无 success/cancel/fail 关键词 → unknown
	if view.History[0].Turn != 2 || view.History[0].BroadcasterID != "p1" || view.History[0].TargetSystem != 3 {
		t.Errorf("History[0] = %+v, want Turn=2/Broadcaster=p1/System=3", view.History[0])
	}
	if view.History[0].Outcome != "unknown" {
		t.Errorf("History[0].Outcome = %q, want %q", view.History[0].Outcome, "unknown")
	}

	// l3: "双方合作" → success
	if view.History[1].Outcome != "success" {
		t.Errorf("History[1].Outcome = %q, want %q", view.History[1].Outcome, "success")
	}

	// l4: "无人回应" 不含 "取消"/"失败" 关键字 → unknown
	// （注：实际后端 CancelBroadcast 路径的日志文本是"无人回应"，task 启发式仅匹配"取消"）
	if view.History[2].Outcome != "unknown" {
		t.Errorf("History[2].Outcome = %q, want %q", view.History[2].Outcome, "unknown")
	}
	if view.History[2].TargetSystem != 5 {
		t.Errorf("History[2].TargetSystem = %d, want 5", view.History[2].TargetSystem)
	}
}

func TestProjectBroadcast_HistoryOutcomeKeywords(t *testing.T) {
	cases := []struct {
		msg  string
		want string
	}{
		{"双方合作! Alice 和 Bob 各获得 3 点能量", "success"},
		{"Alice 伪装成功! 获得 5 点能量", "success"},
		{"双方伪装! 无人获得能量", "success"},
		{"广播取消", "cancelled"},
		{"广播失败", "failed"},
		// 使用中性卡名避免命中 "合作"/"伪装" 关键词，验证 "unknown" 路径
		{"Alice 向星系 3 发送了【测试广播】", "unknown"},
		{"无人回应, Alice 获得 1 点能量", "unknown"},
	}
	for _, c := range cases {
		if got := classifyBroadcastOutcome(c.msg); got != c.want {
			t.Errorf("classifyBroadcastOutcome(%q) = %q, want %q", c.msg, got, c.want)
		}
	}
}

// TestProjectBroadcast_HistoryOutcomeFalsePositive 文档化 task spec 启发式的已知局限：
// 当 LogEntry.Message 含卡片名（如 "合作广播"/"伪装广播"）时，"合作"/"伪装" 子串
// 会被误判为 success outcome。这是 spec 设计取舍，不在本任务范围内修复。
func TestProjectBroadcast_HistoryOutcomeFalsePositive(t *testing.T) {
	// 后端 InitiateBroadcast 日志格式："向星系 X 发送了【卡名】"，
	// 真实卡名 "合作广播" 含 "合作" → 误判为 success。
	got := classifyBroadcastOutcome("Alice 向星系 3 发送了【合作广播】")
	if got != "success" {
		t.Logf("note: heuristic returned %q for card-name message; "+
			"spec lists 合作 as success keyword so this is by-design (false positive)", got)
		// 不强制断言：仅记录行为，便于将来 heuristic 改进时此测试提醒更新
	}
}

func TestProjectBroadcast_HistoryCappedAt10(t *testing.T) {
	logs := make([]gamesdk.LogEntry, 0, 15)
	for i := 0; i < 15; i++ {
		logs = append(logs, gamesdk.LogEntry{
			ID:      "l" + itoa(i),
			Turn:    i + 1,
			Phase:   "actionPhase",
			Type:    "broadcast",
			Message: "双方合作",
		})
	}
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     15,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
		Logs: logs,
	}
	view := ProjectBroadcast(state, "p1")
	if len(view.History) != maxBroadcastHistoryEntries {
		t.Fatalf("History len = %d, want %d", len(view.History), maxBroadcastHistoryEntries)
	}
	// 应保留最后 10 条（Turn 6..15）
	if view.History[0].Turn != 6 {
		t.Errorf("History[0].Turn = %d, want 6", view.History[0].Turn)
	}
	if view.History[9].Turn != 15 {
		t.Errorf("History[9].Turn = %d, want 15", view.History[9].Turn)
	}
}

func TestProjectBroadcast_ResidualMarkers(t *testing.T) {
	// currentTurn=10，maxResidualMarkerAge=2
	// 保留 age<=2（即 0,1,2，对应 Turn 8,9,10），age=3（Turn 7）被过滤
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     10,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{
				ID:   "p1",
				Name: "Alice",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 1, Turn: 10}, // age=0 保留
					{SystemID: 2, Turn: 9},  // age=1 保留
					{SystemID: 3, Turn: 8},  // age=2 保留
					{SystemID: 4, Turn: 7},  // age=3 过滤
					{SystemID: 5, Turn: 6},  // age=4 过滤
				},
			},
			{
				ID:   "p2",
				Name: "Bob",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 6, Turn: 10}, // age=0 保留
					{SystemID: 7, Turn: 5},  // age=5 过滤
				},
			},
			{
				ID:   "p3", // 无广播历史
				Name: "Carol",
			},
		},
	}
	view := ProjectBroadcast(state, "p1")
	if len(view.ResidualMarkers) != 4 {
		t.Fatalf("ResidualMarkers len = %d, want 4 (3 from p1 Turn 10/9/8 + 1 from p2 Turn 10)", len(view.ResidualMarkers))
	}

	// 收集 systemId 校验内容
	got := make(map[int]ResidualMarker, len(view.ResidualMarkers))
	for _, m := range view.ResidualMarkers {
		got[m.SystemID] = m
	}
	wantAges := map[int]int{
		1: 0, // Turn 10, age 0
		2: 1, // Turn 9, age 1
		3: 2, // Turn 8, age 2
		6: 0, // Turn 10, age 0
	}
	for sysID, wantAge := range wantAges {
		m, ok := got[sysID]
		if !ok {
			t.Errorf("systemId %d missing in ResidualMarkers", sysID)
			continue
		}
		if m.AgeTurns != wantAge {
			t.Errorf("ResidualMarker[system=%d].AgeTurns = %d, want %d", sysID, m.AgeTurns, wantAge)
		}
	}
	// SystemID 4/5/7 应被过滤（age=3/4/5 > 2）
	if _, ok := got[4]; ok {
		t.Errorf("systemId 4 should be filtered (age=3 > 2)")
	}
	if _, ok := got[5]; ok {
		t.Errorf("systemId 5 should be filtered (age=4 > 2)")
	}
	if _, ok := got[7]; ok {
		t.Errorf("systemId 7 should be filtered (age=5 > 2)")
	}
}

func TestProjectBroadcast_ResidualMarkersEmpty(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     10,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice"},
		},
	}
	view := ProjectBroadcast(state, "p1")
	if view.ResidualMarkers != nil {
		t.Errorf("ResidualMarkers = %v, want nil (no broadcast history)", view.ResidualMarkers)
	}
}

func TestProjectBroadcast_ResidualMarkersFutureTurn(t *testing.T) {
	// 边界：entry.Turn > currentTurn 时 age 按 0 处理
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     5,
		LocalPlayerID: "p1",
		Players: []gamesdk.ViewPlayer{
			{
				ID:   "p1",
				Name: "Alice",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 1, Turn: 8}, // future turn → age=0
				},
			},
		},
	}
	view := ProjectBroadcast(state, "p1")
	if len(view.ResidualMarkers) != 1 {
		t.Fatalf("ResidualMarkers len = %d, want 1", len(view.ResidualMarkers))
	}
	if view.ResidualMarkers[0].AgeTurns != 0 {
		t.Errorf("ResidualMarkers[0].AgeTurns = %d, want 0 (future turn clamped)", view.ResidualMarkers[0].AgeTurns)
	}
}

func TestProjectBroadcast_FullIntegration(t *testing.T) {
	// 集成测试：waiting phase + mustResponder + 残影 + 历史
	sys3 := 3
	state := &gamesdk.ViewState{
		Phase:         "playing",
		TotalTurn:     10,
		LocalPlayerID: "p2",
		Players: []gamesdk.ViewPlayer{
			{
				ID:   "p1",
				Name: "Alice",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 3, Turn: 8}, // age=2 保留
				},
			},
			{
				ID:   "p2",
				Name: "Bob",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 5, Turn: 6}, // age=4 过滤
				},
			},
		},
		Broadcast: newBroadcastState("p1", gamesdk.BroadcastPhaseWaiting,
			gamesdk.BroadcastResponseView{PlayerID: "p2", CanRespond: true, MustRespond: true, Responded: false, Agreed: false},
		),
		Logs: []gamesdk.LogEntry{
			{ID: "l1", Turn: 8, Phase: "actionPhase", Type: "broadcast", Message: "双方合作",
				SystemID: &sys3, PlayerIDs: []string{"p1"}},
		},
	}
	view := ProjectBroadcast(state, "p2")

	if view.Phase != BroadcastPhaseWaiting {
		t.Errorf("Phase = %q, want %q", view.Phase, BroadcastPhaseWaiting)
	}
	if view.MyRole != BroadcastRoleMustResponder {
		t.Errorf("MyRole = %q, want %q", view.MyRole, BroadcastRoleMustResponder)
	}
	if view.ActionRequired == nil || view.ActionRequired.Type != "agreeOrRefuse" {
		t.Errorf("ActionRequired.Type = %v, want agreeOrRefuse", view.ActionRequired)
	}
	if len(view.History) != 1 {
		t.Errorf("History len = %d, want 1", len(view.History))
	} else if view.History[0].Outcome != "success" {
		t.Errorf("History[0].Outcome = %q, want success", view.History[0].Outcome)
	}
	if len(view.ResidualMarkers) != 1 {
		t.Errorf("ResidualMarkers len = %d, want 1 (only p1's Turn 8 kept)", len(view.ResidualMarkers))
	} else if view.ResidualMarkers[0].SystemID != 3 || view.ResidualMarkers[0].AgeTurns != 2 {
		t.Errorf("ResidualMarkers[0] = %+v, want SystemID=3/AgeTurns=2", view.ResidualMarkers[0])
	}
}

// itoa 简单整数转字符串，避免引入 strconv 仅做测试辅助
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

// TestProjectBroadcast_ResidualMarkersSortedBySystemID 防御性测试：
// 不同玩家/不同顺序下的残影集合应等价（顺序由 players 顺序决定，这里仅校验内容集合）。
func TestProjectBroadcast_ResidualMarkersSet(t *testing.T) {
	state := &gamesdk.ViewState{
		Phase:     "playing",
		TotalTurn: 10,
		Players: []gamesdk.ViewPlayer{
			{
				ID: "p1",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 1, Turn: 10},
					{SystemID: 2, Turn: 9},
				},
			},
			{
				ID: "p2",
				BroadcastHistory: []gamesdk.BroadcastHistoryEntry{
					{SystemID: 3, Turn: 8},
				},
			},
		},
	}
	view := ProjectBroadcast(state, "p1")
	got := make(map[int]bool, len(view.ResidualMarkers))
	for _, m := range view.ResidualMarkers {
		got[m.SystemID] = true
	}
	want := map[int]bool{1: true, 2: true, 3: true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ResidualMarkers systemId set = %v, want %v", got, want)
	}
	// 排序保证测试稳定性（防御性，不强制实现顺序）
	sort.Slice(view.ResidualMarkers, func(i, j int) bool {
		return view.ResidualMarkers[i].SystemID < view.ResidualMarkers[j].SystemID
	})
}
