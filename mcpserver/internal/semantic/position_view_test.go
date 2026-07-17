package semantic

import (
	"encoding/json"
	"reflect"
	"sort"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// newPositionState 构造一个基础 2 玩家 playing 状态：
// p1 在星系 5，p2 位置未知（-1），无摧毁星系、无飞行打击、无广播。
func newPositionState() *gamesdk.ViewState {
	return &gamesdk.ViewState{
		Kind:            "view",
		Phase:           "playing",
		TotalTurn:       5,
		PlayerCount:     2,
		CurrentPlayerID: "p1",
		LocalPlayerID:   "p1",
		TurnPhase:       "actionPhase",
		Players: []gamesdk.ViewPlayer{
			{ID: "p1", Name: "Alice", Color: "red", Position: 5, Energy: 5},
			{ID: "p2", Name: "Bob", Color: "blue", Position: -1, Energy: 3, HandCount: 2},
		},
	}
}

// TestProjectPosition_NilState 验证 nil ViewState 返回零值 PositionView。
func TestProjectPosition_NilState(t *testing.T) {
	view := ProjectPosition(nil, "p1", "classic")
	if view.MyPosition.System != 0 {
		t.Errorf("MyPosition.System = %d, want 0", view.MyPosition.System)
	}
	if view.MyPosition.IsPublic {
		t.Errorf("MyPosition.IsPublic = true, want false")
	}
	if view.MyPosition.IsExposedByBroadcast {
		t.Errorf("MyPosition.IsExposedByBroadcast = true, want false")
	}
	if len(view.Reachable) != 0 {
		t.Errorf("Reachable = %v, want empty", view.Reachable)
	}
	if len(view.SafeZones) != 0 {
		t.Errorf("SafeZones = %v, want empty", view.SafeZones)
	}
	if len(view.DangerZones) != 0 {
		t.Errorf("DangerZones = %v, want empty", view.DangerZones)
	}
	if view.KnownFoePositions != nil {
		t.Errorf("KnownFoePositions = %v, want nil", view.KnownFoePositions)
	}
}

// TestProjectPosition_MyPosition_Basic 验证 MyPosition 基本字段。
// 无广播历史 → IsPublic=false；无活跃广播 → IsExposedByBroadcast=false。
func TestProjectPosition_MyPosition_Basic(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "classic")

	if view.MyPosition.System != 5 {
		t.Errorf("MyPosition.System = %d, want 5", view.MyPosition.System)
	}
	if view.MyPosition.IsPublic {
		t.Errorf("MyPosition.IsPublic = true, want false (no broadcast history)")
	}
	if view.MyPosition.IsExposedByBroadcast {
		t.Errorf("MyPosition.IsExposedByBroadcast = true, want false (no broadcast)")
	}
}

// TestProjectPosition_MyPosition_PublicViaBroadcastHistory 验证
// 有 BroadcastHistory 时 IsPublic=true（启发式：广播会暴露广播者位置）。
func TestProjectPosition_MyPosition_PublicViaBroadcastHistory(t *testing.T) {
	state := newPositionState()
	state.Players[0].BroadcastHistory = []gamesdk.BroadcastHistoryEntry{
		{SystemID: 5, Turn: 3},
	}
	view := ProjectPosition(state, "p1", "classic")
	if !view.MyPosition.IsPublic {
		t.Errorf("MyPosition.IsPublic = false, want true (has broadcast history)")
	}
}

// TestProjectPosition_MyPosition_ExposedByBroadcast 验证
// 活跃广播照亮 myPosition 时 IsExposedByBroadcast=true。
func TestProjectPosition_MyPosition_ExposedByBroadcast(t *testing.T) {
	state := newPositionState()
	state.Broadcast = &gamesdk.BroadcastStateView{
		BroadcasterID: "p2",
		TargetSystem:  5, // == myPosition
		Phase:         gamesdk.BroadcastPhaseSelect,
	}
	view := ProjectPosition(state, "p1", "classic")
	if !view.MyPosition.IsExposedByBroadcast {
		t.Errorf("MyPosition.IsExposedByBroadcast = false, want true (active broadcast on myPosition)")
	}
}

// TestProjectPosition_MyPosition_NotExposedWhenBroadcastOnOtherSystem
// 广播照亮其他星系时 IsExposedByBroadcast=false。
func TestProjectPosition_MyPosition_NotExposedWhenBroadcastOnOtherSystem(t *testing.T) {
	state := newPositionState()
	state.Broadcast = &gamesdk.BroadcastStateView{
		BroadcasterID: "p2",
		TargetSystem:  3, // != myPosition (5)
		Phase:         gamesdk.BroadcastPhaseSelect,
	}
	view := ProjectPosition(state, "p1", "classic")
	if view.MyPosition.IsExposedByBroadcast {
		t.Errorf("MyPosition.IsExposedByBroadcast = true, want false (broadcast on other system)")
	}
}

// TestProjectPosition_MyPosition_NotExposedWhenBroadcastNil
// state.Broadcast 为 nil 时 IsExposedByBroadcast=false。
func TestProjectPosition_MyPosition_NotExposedWhenBroadcastNil(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "classic")
	if view.MyPosition.IsExposedByBroadcast {
		t.Errorf("MyPosition.IsExposedByBroadcast = true, want false (broadcast is nil)")
	}
}

// TestProjectPosition_MyPosition_NotExposedWhenBroadcastDone
// 广播 Phase == "done" 时视为已结束，IsExposedByBroadcast=false。
// 当前 gamesdk 协议未定义 done，此处验证防御性兼容逻辑。
func TestProjectPosition_MyPosition_NotExposedWhenBroadcastDone(t *testing.T) {
	state := newPositionState()
	state.Broadcast = &gamesdk.BroadcastStateView{
		BroadcasterID: "p2",
		TargetSystem:  5, // == myPosition
		Phase:         "done",
	}
	view := ProjectPosition(state, "p1", "classic")
	if view.MyPosition.IsExposedByBroadcast {
		t.Errorf("MyPosition.IsExposedByBroadcast = true, want false (broadcast phase done)")
	}
}

// TestProjectPosition_Reachable_Classic 验证 Classic 模式下 Reachable 计算。
// self@5, foe@-1, 无摧毁星系 → Reachable = [1,2,3,4,6,7,8,9]（排除 5 自身）。
// 光速飞船为"跃迁"语义，不受距离限制，等价于 1-9 减去当前星系。
func TestProjectPosition_Reachable_Classic(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "classic")
	want := []int{1, 2, 3, 4, 6, 7, 8, 9}
	if !reflect.DeepEqual(view.Reachable, want) {
		t.Errorf("Reachable = %v, want %v", view.Reachable, want)
	}
}

// TestProjectPosition_Reachable_Relics 验证 Relics 模式下 Reachable 计算。
// 与 Classic 相同（光速飞船为跃迁，不受距离限制，两种模式计算一致）。
func TestProjectPosition_Reachable_Relics(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "civilization_relics")
	want := []int{1, 2, 3, 4, 6, 7, 8, 9}
	if !reflect.DeepEqual(view.Reachable, want) {
		t.Errorf("Reachable = %v, want %v", view.Reachable, want)
	}
}

// TestProjectPosition_Reachable_ExcludesOccupied
// 验证 Reachable 排除被占用星系，但保留已摧毁星系（对齐前端/后端）。
// self@5, foe@3 (occupied), destroyed@7 → Reachable = [1,2,4,6,7,8,9]。
func TestProjectPosition_Reachable_ExcludesOccupied(t *testing.T) {
	state := newPositionState()
	state.Players[1].Position = 3 // foe 占用星系 3
	state.DestroyedStars = []int{7}
	view := ProjectPosition(state, "p1", "classic")
	want := []int{1, 2, 4, 6, 7, 8, 9}
	if !reflect.DeepEqual(view.Reachable, want) {
		t.Errorf("Reachable = %v, want %v", view.Reachable, want)
	}
}

// TestProjectPosition_Reachable_SelfPositionUnknown
// 观察者位置未知（Position=-1，viewer 未找到）时 Reachable 为空。
func TestProjectPosition_Reachable_SelfPositionUnknown(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "ghost", "classic")
	if len(view.Reachable) != 0 {
		t.Errorf("Reachable = %v, want empty (viewer not found, myPosition unknown)", view.Reachable)
	}
}

// TestProjectPosition_SafeZones 验证 SafeZones 过滤飞行打击目标与活跃广播目标。
// Reachable = [1,2,3,4,6,7,8,9]
// 排除 2 (strike), 6 (strike), 4 (broadcast) → SafeZones = [1,3,7,8,9]。
func TestProjectPosition_SafeZones(t *testing.T) {
	state := newPositionState()
	state.FlyingStrikes = []gamesdk.FlyingStrike{
		{UID: "s1", TargetSystem: 2},
		{UID: "s2", TargetSystem: 6},
	}
	state.Broadcast = &gamesdk.BroadcastStateView{
		TargetSystem: 4,
		Phase:        gamesdk.BroadcastPhaseSelect,
	}
	view := ProjectPosition(state, "p1", "classic")
	want := []int{1, 3, 7, 8, 9}
	if !reflect.DeepEqual(view.SafeZones, want) {
		t.Errorf("SafeZones = %v, want %v", view.SafeZones, want)
	}
}

// TestProjectPosition_SafeZones_AllDangerous 验证所有可达星系均危险时 SafeZones 为空。
func TestProjectPosition_SafeZones_AllDangerous(t *testing.T) {
	state := newPositionState()
	// 用飞行打击覆盖所有 Reachable 星系
	state.FlyingStrikes = []gamesdk.FlyingStrike{
		{UID: "s1", TargetSystem: 1},
		{UID: "s2", TargetSystem: 2},
		{UID: "s3", TargetSystem: 3},
		{UID: "s4", TargetSystem: 4},
		{UID: "s5", TargetSystem: 6},
		{UID: "s6", TargetSystem: 7},
		{UID: "s7", TargetSystem: 8},
		{UID: "s8", TargetSystem: 9},
	}
	view := ProjectPosition(state, "p1", "classic")
	if len(view.SafeZones) != 0 {
		t.Errorf("SafeZones = %v, want empty (all reachable systems dangerous)", view.SafeZones)
	}
}

// TestProjectPosition_DangerZones 验证 DangerZones 风险分类。
// Reachable = [1,2,3,4,6,7,8,9]
// DangerZones: 2 (inbound_strike), 4 (broadcast_exposed), 6 (inbound_strike)。
func TestProjectPosition_DangerZones(t *testing.T) {
	state := newPositionState()
	state.FlyingStrikes = []gamesdk.FlyingStrike{
		{UID: "s1", TargetSystem: 2},
		{UID: "s2", TargetSystem: 6},
	}
	state.Broadcast = &gamesdk.BroadcastStateView{
		TargetSystem: 4,
		Phase:        gamesdk.BroadcastPhaseSelect,
	}
	view := ProjectPosition(state, "p1", "classic")

	dangers := make(map[int][]string)
	for _, d := range view.DangerZones {
		sort.Strings(d.Risks)
		dangers[d.System] = d.Risks
	}
	if len(dangers) != 3 {
		t.Fatalf("DangerZones len = %d, want 3 (got %v)", len(dangers), view.DangerZones)
	}
	if got := dangers[2]; !reflect.DeepEqual(got, []string{"inbound_strike"}) {
		t.Errorf("DangerZones[2] = %v, want [inbound_strike]", got)
	}
	if got := dangers[4]; !reflect.DeepEqual(got, []string{"broadcast_exposed"}) {
		t.Errorf("DangerZones[4] = %v, want [broadcast_exposed]", got)
	}
	if got := dangers[6]; !reflect.DeepEqual(got, []string{"inbound_strike"}) {
		t.Errorf("DangerZones[6] = %v, want [inbound_strike]", got)
	}
}

// TestProjectPosition_DangerZones_CombinedRisks 验证
// 同一星系可叠加多个风险标签（inbound_strike + broadcast_exposed）。
func TestProjectPosition_DangerZones_CombinedRisks(t *testing.T) {
	state := newPositionState()
	// 星系 2 同时是飞行打击目标 + 广播照亮
	state.FlyingStrikes = []gamesdk.FlyingStrike{
		{UID: "s1", TargetSystem: 2},
	}
	state.Broadcast = &gamesdk.BroadcastStateView{
		TargetSystem: 2,
		Phase:        gamesdk.BroadcastPhaseSelect,
	}
	view := ProjectPosition(state, "p1", "classic")

	var risk2 []string
	for _, d := range view.DangerZones {
		if d.System == 2 {
			sort.Strings(d.Risks)
			risk2 = d.Risks
			break
		}
	}
	if risk2 == nil {
		t.Fatalf("DangerZones does not contain system 2 (got %v)", view.DangerZones)
	}
	want := []string{"broadcast_exposed", "inbound_strike"}
	if !reflect.DeepEqual(risk2, want) {
		t.Errorf("DangerZones[2] = %v, want %v", risk2, want)
	}
}

// TestProjectPosition_DangerZones_EmptyWhenNoRisks
// 无飞行打击且无活跃广播时 DangerZones 为空。
func TestProjectPosition_DangerZones_EmptyWhenNoRisks(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "classic")
	if len(view.DangerZones) != 0 {
		t.Errorf("DangerZones = %v, want empty (no strikes, no broadcast)", view.DangerZones)
	}
}

// TestProjectPosition_DangerZones_BroadcastDoneNotCounted
// 广播 Phase == "done" 时不计入 broadcast_exposed 风险。
func TestProjectPosition_DangerZones_BroadcastDoneNotCounted(t *testing.T) {
	state := newPositionState()
	state.Broadcast = &gamesdk.BroadcastStateView{
		TargetSystem: 4,
		Phase:        "done",
	}
	view := ProjectPosition(state, "p1", "classic")
	for _, d := range view.DangerZones {
		if d.System == 4 {
			t.Errorf("DangerZones should not contain system 4 when broadcast phase=done (got %v)", d)
		}
	}
}

// TestProjectPosition_KnownFoePositions 验证仅含已知位置（Position > 0）的对手。
// Position == -1 或 == 0 的对手跳过，不放入 map。
func TestProjectPosition_KnownFoePositions(t *testing.T) {
	state := newPositionState()
	state.Players = []gamesdk.ViewPlayer{
		{ID: "p1", Name: "Alice", Position: 5},
		{ID: "p2", Name: "Bob", Position: -1},  // 未知，跳过
		{ID: "p3", Name: "Carol", Position: 7}, // 已知
		{ID: "p4", Name: "Dave", Position: 0},  // 未知（0），跳过
	}
	view := ProjectPosition(state, "p1", "classic")
	want := map[string]int{"p3": 7}
	if !reflect.DeepEqual(view.KnownFoePositions, want) {
		t.Errorf("KnownFoePositions = %v, want %v", view.KnownFoePositions, want)
	}
}

// TestProjectPosition_KnownFoePositions_EmptyWhenAllUnknown
// 所有对手位置均未知时 KnownFoePositions 为 nil（omitempty 生效）。
func TestProjectPosition_KnownFoePositions_EmptyWhenAllUnknown(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "classic")
	if view.KnownFoePositions != nil {
		t.Errorf("KnownFoePositions = %v, want nil (all foes unknown)", view.KnownFoePositions)
	}
}

// TestProjectPosition_ViewerNotFound 验证 viewerID 不在 Players 中时
// MyPosition.System=0，Reachable 为空，但仍投影 KnownFoePositions。
func TestProjectPosition_ViewerNotFound(t *testing.T) {
	state := newPositionState()
	state.Players[1].Position = 7 // foe 已知
	view := ProjectPosition(state, "ghost", "classic")

	if view.MyPosition.System != 0 {
		t.Errorf("MyPosition.System = %d, want 0 (viewer not found)", view.MyPosition.System)
	}
	if view.MyPosition.IsPublic {
		t.Errorf("MyPosition.IsPublic = true, want false (no viewer)")
	}
	if len(view.Reachable) != 0 {
		t.Errorf("Reachable = %v, want empty (no myPosition)", view.Reachable)
	}
	// KnownFoePositions 仍应包含 p2 (位置 7)
	if pos, ok := view.KnownFoePositions["p2"]; !ok || pos != 7 {
		t.Errorf("KnownFoePositions[p2] = %d (ok=%v), want 7", pos, ok)
	}
}

// TestProjectPosition_SafeAndDangerPartitionReachable
// 验证 SafeZones ∪ DangerZones == Reachable，且两者不相交（分区性质）。
// 这是 Reachable 投影的关键不变量：每个可达星系要么安全要么危险。
func TestProjectPosition_SafeAndDangerPartitionReachable(t *testing.T) {
	state := newPositionState()
	state.FlyingStrikes = []gamesdk.FlyingStrike{
		{UID: "s1", TargetSystem: 2},
		{UID: "s2", TargetSystem: 6},
	}
	state.Broadcast = &gamesdk.BroadcastStateView{
		TargetSystem: 4,
		Phase:        gamesdk.BroadcastPhaseSelect,
	}
	view := ProjectPosition(state, "p1", "classic")

	safeSet := make(map[int]bool)
	for _, s := range view.SafeZones {
		safeSet[s] = true
	}
	dangerSet := make(map[int]bool)
	for _, d := range view.DangerZones {
		dangerSet[d.System] = true
	}

	for _, sys := range view.Reachable {
		isSafe := safeSet[sys]
		isDanger := dangerSet[sys]
		if isSafe && isDanger {
			t.Errorf("system %d is both safe and dangerous", sys)
		}
		if !isSafe && !isDanger {
			t.Errorf("system %d is neither safe nor dangerous (partition violated)", sys)
		}
	}
}

// TestProjectPosition_JSONSerialization 验证 PositionView 能正确序列化为 JSON，
// 且 omitempty 生效（空切片/nil map 不输出）。
func TestProjectPosition_JSONSerialization(t *testing.T) {
	state := newPositionState()
	view := ProjectPosition(state, "p1", "classic")

	// 序列化不应报错；Reachable 非空应输出，SafeZones 非空应输出，
	// DangerZones 为空应省略，KnownFoePositions 为 nil 应省略。
	data, err := json.Marshal(view)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	t.Logf("PositionView JSON: %s", data)
}
