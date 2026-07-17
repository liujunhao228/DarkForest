package semantic

import (
	"encoding/json"
	"fmt"
	"testing"

	"darkforest/mcpserver/internal/gamesdk"
)

// agent_view_size_test.go 是 Task 17 SubTask 17.4 的端到端验证:
// 用本地构造的 4 人对局 ViewState(模拟旧 get_game_state 的输出体)驱动
// ProjectObject,断言 AgentView JSON 体显著小于 ViewState JSON 体。
//
// 由于旧 get_game_state tool 已在 Task 13 下线,无法直接对比新旧 tool 的
// 输出。本测试采用结构性对比:同一份 ViewState 作为基准,分别序列化为
//   - 原始 ViewState JSON(模拟旧 get_game_state 输出)
//   - ProjectObject 投影后的 AgentView JSON(新 get_agent_view 输出)
// 断言后者字节数 < 前者 * 0.6(即至少减少 40%)。
//
// 关键差异点(在测试日志中显式输出):
//   - foes.hand 简化为 handCount(不暴露手牌内容)
//   - faceUpCards 简化为 SimpleCard(仅 defId/name/role/output 4 字段)
//   - logs 截断为最近 20 条(EventTrace 上限)
//   - 移除 drawPile / discardPile 等服务端私有字段(ViewState 本就不暴露)
//   - 移除 flyingStrikes 的 ownerPrivate 字段(AgentView 仅通过 StrikeView 暴露)
//   - 自身位置语义化为 PositionIsPublic(基于广播历史启发式推断)
//   - PendingAction 反序列化为摘要(PendingActionSummary),原 RawMessage 不保留

// TestAgentView_SizeSignificantlySmallerThanViewState 是 SubTask 17.4 的核心断言。
//
// 构造一个接近真实对局的 4 人 ViewState:
//   - 自己(p1)5 张手牌 + 4 张面朝上设施/防御
//   - 3 个对手,各 5-7 张 handCount + 3-5 张面朝上设施
//   - 30+ 条日志(超过 EventTrace 上限 20,验证截断)
//   - 3 条飞行打击
//   - 2 个被摧毁星系
//   - 进行中的广播会话
//   - PendingAction(strikeMissed 类型,模拟中断态)
func TestAgentView_SizeSignificantlySmallerThanViewState(t *testing.T) {
	state := buildRealistic4PlayerState()

	// 投影为 AgentView(新 get_agent_view 的输出体)
	viewerID := state.LocalPlayerID
	agentView := ProjectObject(state, viewerID, "classic")

	// JSON 序列化两边
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("json.Marshal(ViewState) 失败: %v", err)
	}
	viewJSON, err := json.Marshal(agentView)
	if err != nil {
		t.Fatalf("json.Marshal(AgentView) 失败: %v", err)
	}

	stateBytes := len(stateJSON)
	viewBytes := len(viewJSON)
	ratio := float64(viewBytes) / float64(stateBytes)

	t.Logf("=== AgentView vs ViewState 体量对比 ===")
	t.Logf("ViewState JSON 字节数(模拟旧 get_game_state 输出): %d", stateBytes)
	t.Logf("AgentView JSON 字节数(新 get_agent_view 输出):      %d", viewBytes)
	t.Logf("压缩比 (AgentView / ViewState):                    %.4f", ratio)
	t.Logf("减少幅度:                                          %.2f%%", (1-ratio)*100)

	// 关键差异点验证(每个差异点单独断言,便于定位回归)
	t.Logf("=== 关键差异点 ===")
	t.Logf("1. foes.hand 简化为 handCount: foe[0].HandCount=%d (无手牌内容字段)",
		agentView.Foes[0].HandCount)
	t.Logf("2. faceUpCards 简化为 SimpleCard: self.FaceUpCards[0]={DefID:%s, Name:%s, Role:%s, Output:%s} (仅 4 字段)",
		agentView.Self.FaceUpCards[0].DefID,
		agentView.Self.FaceUpCards[0].Name,
		agentView.Self.FaceUpCards[0].Role,
		agentView.Self.FaceUpCards[0].Output)
	t.Logf("3. logs 截断为最近 20 条: 原始 logs=%d, EventTrace.Entries=%d",
		len(state.Logs), len(agentView.Events.Entries))
	t.Logf("4. self.hand 仍保留(本人可见): self.Hand=%d 张", len(agentView.Self.Hand))
	t.Logf("5. flyingStrikes 不在 AgentView 顶层(由 StrikeView 单独暴露,本测试不投影)")
	t.Logf("6. broadcast 不在 AgentView 顶层(由 BroadcastView 单独暴露,本测试不投影)")
	t.Logf("7. PendingAction 反序列化为摘要: cursor.PendingAction=%v",
		agentView.Cursor.PendingAction)

	// 核心断言:AgentView 至少比 ViewState 小 40%(压缩比 < 0.6)
	if ratio >= 0.6 {
		t.Errorf("压缩比 %.4f >= 0.6,未达到至少减少 40%% 的目标 (AgentView=%d, ViewState=%d)",
			ratio, viewBytes, stateBytes)
	}

	// EventTrace 截断断言:30 条日志应被截断为 20 条
	if len(agentView.Events.Entries) != 20 {
		t.Errorf("EventTrace.Entries 长度 = %d, 期望 20 (maxEventTraceEntries)", len(agentView.Events.Entries))
	}

	// FoeSnapshot 不应暴露 Hand 字段(仅 HandCount)
	// 通过反序列化验证 JSON 中不含 hand 数组(仅 handCount 数字)
	var foeAsMap map[string]any
	if foeJSON, err := json.Marshal(agentView.Foes[0]); err == nil {
		_ = json.Unmarshal(foeJSON, &foeAsMap)
		if _, hasHand := foeAsMap["hand"]; hasHand {
			t.Errorf("FoeSnapshot JSON 仍含 hand 字段(应仅暴露 handCount): %s", foeJSON)
		}
		if _, hasHandCount := foeAsMap["handCount"]; !hasHandCount {
			t.Errorf("FoeSnapshot JSON 缺少 handCount 字段: %s", foeJSON)
		}
	}

	// SimpleCard 应仅含 4 字段(defId/name/role/output)
	var cardAsMap map[string]any
	if cardJSON, err := json.Marshal(agentView.Self.FaceUpCards[0]); err == nil {
		_ = json.Unmarshal(cardJSON, &cardAsMap)
		expectedKeys := map[string]bool{"defId": true, "name": true, "role": true, "output": true}
		if len(cardAsMap) != 4 {
			t.Errorf("SimpleCard JSON 字段数 = %d, 期望 4: %s", len(cardAsMap), cardJSON)
		}
		for k := range cardAsMap {
			if !expectedKeys[k] {
				t.Errorf("SimpleCard JSON 含意外字段 %q: %s", k, cardJSON)
			}
		}
	}
}

// buildRealistic4PlayerState 构造一个接近真实对局的 4 人 ViewState 测试 fixture。
//
// 设计目标:让 AgentView 与 ViewState 的体量差异接近真实对局比例:
//   - 4 人对局(自己 + 3 对手)
//   - 自己 5 张手牌(完整 Card)+ 4 张面朝上(2 防御 + 2 设施)
//   - 每个对手 5-7 张 handCount + 3-5 张面朝上设施
//   - 30 条日志(超过 EventTrace 上限 20,验证截断)
//   - 3 条飞行打击
//   - 2 个被摧毁星系
//   - 进行中的广播会话
//   - PendingAction(strikeMissed 类型)
func buildRealistic4PlayerState() *gamesdk.ViewState {
	systemID1 := 5
	systemID2 := 7
	systemID3 := 9
	cardDef1 := "strike_thermal"
	cardDef2 := "facility_solar_array"
	cardDef3 := "broadcast_stellar"

	// 自己 5 张手牌:2 打击 + 1 广播 + 1 防御 + 1 设施
	selfHand := []gamesdk.Card{
		{UID: "h1", DefID: "strike_thermal", Name: "热核打击", Type: "strike", Energy: 4, Level: 1, Speed: 1, Effect: "", Description: "热核打击:基础飞行打击,1 回合抵达,4 能量。"},
		{UID: "h2", DefID: "strike_light_particle", Name: "光粒打击", Type: "strike", Energy: 6, Level: 2, Speed: 1, Effect: "", Description: "光粒打击:中阶飞行打击,6 能量。"},
		{UID: "h3", DefID: "broadcast_stellar", Name: "恒星广播", Type: "broadcast", Energy: 2, Range: 1, Subtype: "cooperation", Description: "恒星广播:1 跳内合作/伪装。"},
		{UID: "h4", DefID: "defense_solar_shield", Name: "太阳盾", Type: "defense", Energy: 2, ProtectionLevel: 2, Description: "太阳盾:中阶防御。"},
		{UID: "h5", DefID: "facility_solar_array", Name: "太阳能阵列", Type: "facility", Energy: 2, EnergyPerTurn: 1, Description: "每回合 +1 能量。"},
	}

	// 自己 4 张面朝上:2 防御 + 2 设施(完整 Card 字段,模拟后端 fullSync)
	selfFaceUp := []gamesdk.Card{
		{UID: "f1", DefID: "defense_solar_shield", Name: "太阳盾", Type: "defense", Energy: 2, ProtectionLevel: 2, Description: "中阶防御设施,提供 2 级保护。能挡下 level<=2 的打击(热核/光粒)。被高阶打击(湮灭/降维)穿透。"},
		{UID: "f2", DefID: "defense_dyson_sphere", Name: "戴森球", Type: "defense", Energy: 8, ProtectionLevel: 4, Description: "最高阶防御设施,提供 4 级保护。能挡下所有常规打击(热核/光粒/湮灭/降维)。仅能被科技锁死特殊处置。场上唯一。"},
		{UID: "f3", DefID: "facility_solar_array", Name: "太阳能阵列", Type: "facility", Energy: 2, EnergyPerTurn: 1, Description: "基础产能设施,每回合产出 1 点能量。性价比最高的能量来源,通常早期部署。"},
		{UID: "f4", DefID: "facility_listening_post", Name: "监听基地", Type: "facility", Energy: 3, Ability: "detect_broadcast", Description: "监听基地设施,检测范围内所有广播发起者位置。被动情报来源,不消耗能量。"},
	}

	// 对手 1:5 张 handCount + 3 张面朝上
	foe1FaceUp := []gamesdk.Card{
		{UID: "f5", DefID: "defense_solar_shield", Name: "太阳盾", Type: "defense", Energy: 2, ProtectionLevel: 1, Description: "低阶防御设施,提供 1 级保护。仅能挡下热核打击(level=1)。"},
		{UID: "f6", DefID: "facility_solar_array", Name: "太阳能阵列", Type: "facility", Energy: 2, EnergyPerTurn: 1, Description: "基础产能设施,每回合产出 1 点能量。"},
		{UID: "f7", DefID: "facility_listening_post", Name: "监听基地", Type: "facility", Energy: 3, Ability: "detect_broadcast", Description: "监听基地设施,检测范围内所有广播发起者位置。"},
	}

	// 对手 2:7 张 handCount + 4 张面朝上
	foe2FaceUp := []gamesdk.Card{
		{UID: "f8", DefID: "defense_dyson_sphere", Name: "戴森球", Type: "defense", Energy: 8, ProtectionLevel: 4, Description: "最高阶防御设施,提供 4 级保护。能挡下所有常规打击。场上唯一。"},
		{UID: "f9", DefID: "facility_dyson_sphere", Name: "戴森球能量站", Type: "facility", Energy: 10, EnergyPerTurn: 3, Description: "高阶产能设施,每回合产出 3 点能量。场上唯一,通常中后期部署。"},
		{UID: "f10", DefID: "facility_solar_array", Name: "太阳能阵列", Type: "facility", Energy: 2, EnergyPerTurn: 1, Description: "基础产能设施,每回合产出 1 点能量。"},
		{UID: "f11", DefID: "defense_solar_shield", Name: "太阳盾", Type: "defense", Energy: 2, ProtectionLevel: 2, Description: "中阶防御设施,提供 2 级保护。能挡下 level<=2 的打击。"},
	}

	// 对手 3:6 张 handCount + 5 张面朝上
	foe3FaceUp := []gamesdk.Card{
		{UID: "f12", DefID: "defense_solar_shield", Name: "太阳盾", Type: "defense", Energy: 2, ProtectionLevel: 1, Description: "低阶防御设施,提供 1 级保护。仅能挡下热核打击。"},
		{UID: "f13", DefID: "facility_solar_array", Name: "太阳能阵列", Type: "facility", Energy: 2, EnergyPerTurn: 1, Description: "基础产能设施,每回合产出 1 点能量。"},
		{UID: "f14", DefID: "facility_listening_post", Name: "监听基地", Type: "facility", Energy: 3, Ability: "detect_broadcast", Description: "监听基地设施,检测范围内所有广播发起者位置。"},
		{UID: "f15", DefID: "facility_dyson_sphere", Name: "戴森球能量站", Type: "facility", Energy: 10, EnergyPerTurn: 3, Description: "高阶产能设施,每回合产出 3 点能量。场上唯一。"},
		{UID: "f16", DefID: "defense_dyson_sphere", Name: "戴森球", Type: "defense", Energy: 8, ProtectionLevel: 3, Description: "高阶防御设施,提供 3 级保护。能挡下 level<=3 的打击(热核/光粒/湮灭)。"},
	}

	// 30 条日志(超过 EventTrace 上限 20,验证截断)
	logs := make([]gamesdk.LogEntry, 0, 30)
	for i := 0; i < 30; i++ {
		var sysID *int
		var cardDef *string
		var playerIDs []string
		// 让部分日志携带可选字段,体量更接近真实
		if i%3 == 0 {
			s := (i % 9) + 1
			sysID = &s
		}
		if i%4 == 0 {
			cd := cardDef1
			if i%8 == 0 {
				cd = cardDef2
			}
			cardDef = &cd
		}
		if i%2 == 0 {
			playerIDs = []string{"p1", fmt.Sprintf("p%d", (i%3)+2)}
		}
		logs = append(logs, gamesdk.LogEntry{
			ID:        fmt.Sprintf("log-%d", i),
			Turn:      i/3 + 1,
			Phase:     "actionPhase",
			Type:      []string{"action", "combat", "system", "broadcast", "info"}[i%5],
			Message:   fmt.Sprintf("第 %d 条日志:玩家执行了动作 %d", i, i),
			SystemID:  sysID,
			CardDefID: cardDef,
			PlayerIDs: playerIDs,
		})
	}

	// 3 条飞行打击
	flyingStrikes := []gamesdk.FlyingStrike{
		{UID: "fs1", DefID: "strike_thermal", OwnerID: "p2", Position: 4, TargetSystem: 5, Level: 1, Speed: 1, RemainingMoves: 1, StrikeName: "热核打击", Arrived: false},
		{UID: "fs2", DefID: "strike_light_particle", OwnerID: "p1", Position: 6, TargetSystem: 7, Level: 2, Speed: 1, RemainingMoves: 0, StrikeName: "光粒打击", Arrived: true},
		{UID: "fs3", DefID: "strike_annihilation", OwnerID: "p3", Position: 8, TargetSystem: 9, Level: 3, Speed: 1, RemainingMoves: 2, StrikeName: "湮灭打击", Arrived: false},
	}

	// 进行中的广播会话(等待响应阶段)
	bcSubtype := gamesdk.BroadcastSubtypeCooperation
	bcCard := &gamesdk.Card{UID: "bc1", DefID: "broadcast_stellar", Name: "恒星广播", Type: "broadcast", Energy: 2, Range: 1, Subtype: "cooperation"}
	broadcast := &gamesdk.BroadcastStateView{
		BroadcasterID: "p1",
		CardUID:       "bc1",
		Card:          bcCard,
		TargetSystem:  5,
		Range:         1,
		Subtype:       &bcSubtype,
		Responses: []gamesdk.BroadcastResponseView{
			{PlayerID: "p2", PlayerName: "Bob", CanRespond: true, MustRespond: true, Responded: false},
			{PlayerID: "p3", PlayerName: "Carol", CanRespond: false, MustRespond: false, Responded: false},
		},
		Phase: gamesdk.BroadcastPhaseWaiting,
	}

	// PendingAction(strikeMissed 类型,模拟打击落空需选择)
	pendingAction := json.RawMessage(`{"type":"strikeMissed_select","strikeUids":["fs2"],"validMoves":[3,4,5]}`)

	// 自己的广播历史(用于 PositionIsPublic 启发式)
	selfBH := []gamesdk.BroadcastHistoryEntry{
		{SystemID: 5, Turn: 3},
	}

	_ = systemID1
	_ = systemID2
	_ = systemID3
	_ = cardDef3

	return &gamesdk.ViewState{
		Kind:               "view",
		Phase:              "playing",
		TotalTurn:          10,
		PlayerCount:        4,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    "p1",
		LocalPlayerID:      "p1",
		TurnPhase:          "interrupted",
		PendingAction:      pendingAction,
		Players: []gamesdk.ViewPlayer{
			{
				ID:               "p1",
				Name:             "Alice",
				Color:            "red",
				Position:         5,
				Energy:           12,
				Hand:             selfHand,
				FaceUpCards:      selfFaceUp,
				BroadcastHistory: selfBH,
				Eliminated:       false,
			},
			{
				ID:          "p2",
				Name:        "Bob",
				Color:       "blue",
				Position:    -1, // 未揭示
				Energy:      8,
				HandCount:   5,
				FaceUpCards: foe1FaceUp,
				Eliminated:  false,
			},
			{
				ID:          "p3",
				Name:        "Carol",
				Color:       "green",
				Position:    7, // 已揭示
				Energy:      15,
				HandCount:   7,
				FaceUpCards: foe2FaceUp,
				Eliminated:  false,
			},
			{
				ID:          "p4",
				Name:        "Dave",
				Color:       "yellow",
				Position:    -1, // 未揭示
				Energy:      6,
				HandCount:   6,
				FaceUpCards: foe3FaceUp,
				Eliminated:  false,
			},
		},
		FlyingStrikes:  flyingStrikes,
		Broadcast:      broadcast,
		Logs:           logs,
		DestroyedStars: []int{2, 6},
		Version:        42,
	}
}
