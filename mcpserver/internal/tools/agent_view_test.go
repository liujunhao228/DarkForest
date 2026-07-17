package tools

import (
	"encoding/json"
	"testing"
)

// TestAgentViewOutputSchema_Generation 验证 outputSchemaFor 能为 4 个新 Output
// 类型成功生成 JSON Schema 且不 panic。
//
// 这是 Phase E Task 9 认知层工具的基本编译/schema 兼容性测试。
// schema 生成失败通常意味着:
//   - 类型字段引用了 json.RawMessage 但未通过 outputSchemaFor 处理(被默认推断为 integer array)
//   - semantic 包导出类型被 jsonschema-go 反射时遇到不支持的 pattern
//
// handler 的 InGame:false 路径需要 mock GameSession 才能端到端测试,
// 留给集成测试覆盖;本测试聚焦 schema 兼容性。
func TestAgentViewOutputSchema_Generation(t *testing.T) {
	// 直接调用 outputSchemaFor,若 panic 则测试失败
	cases := []struct {
		name string
	}{
		{"GetAgentViewOutput"},
		{"GetAffordancesOutput"},
		{"GetRecentDeltaOutput"},
		{"GetTurnDeltaOutput"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var schema any
			switch tc.name {
			case "GetAgentViewOutput":
				schema = outputSchemaFor[GetAgentViewOutput]()
			case "GetAffordancesOutput":
				schema = outputSchemaFor[GetAffordancesOutput]()
			case "GetRecentDeltaOutput":
				schema = outputSchemaFor[GetRecentDeltaOutput]()
			case "GetTurnDeltaOutput":
				schema = outputSchemaFor[GetTurnDeltaOutput]()
			}
			if schema == nil {
				t.Fatalf("outputSchemaFor[%s] returned nil", tc.name)
			}
			// 序列化 schema 验证可 JSON 化
			data, err := json.Marshal(schema)
			if err != nil {
				t.Fatalf("marshal schema for %s: %v", tc.name, err)
			}
			if len(data) == 0 {
				t.Errorf("schema for %s marshalled to empty bytes", tc.name)
			}
			t.Logf("%s schema: %s", tc.name, data)
		})
	}
}

// TestWaitForEventOutput_WithDeltaField 验证 wait_for_event 修改后
// 的 OutputSchema 仍可正确生成(包含新增的 Delta 字段)。
func TestWaitForEventOutput_WithDeltaField(t *testing.T) {
	schema := outputSchemaFor[WaitForEventOutput]()
	if schema == nil {
		t.Fatal("outputSchemaFor[WaitForEventOutput] returned nil")
	}
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		t.Fatalf("marshal schema: %v", err)
	}
	var schemaMap map[string]any
	if err := json.Unmarshal(data, &schemaMap); err != nil {
		t.Fatalf("unmarshal schema: %v", err)
	}
	props, ok := schemaMap["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema.properties not a map: %T", schemaMap["properties"])
	}
	if _, ok := props["delta"]; !ok {
		t.Errorf("schema.properties.delta missing; got keys: %v", keysOf(props))
	}
	if _, ok := props["hasEvent"]; !ok {
		t.Errorf("schema.properties.hasEvent missing")
	}
	if _, ok := props["events"]; !ok {
		t.Errorf("schema.properties.events missing")
	}
}

// TestJoinMatchQueueInput_GameModeField 验证 join_match_queue 加入 GameMode 字段后
// Input schema 能正确生成(基本字段存在性检查)。
func TestJoinMatchQueueInput_GameModeField(t *testing.T) {
	// 仅编译时验证字段存在 + JSON tag 正确
	in := JoinMatchQueueInput{
		PreferredCount: 4,
		GameMode:       "civilization_relics",
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal JoinMatchQueueInput: %v", err)
	}
	var roundTrip map[string]any
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := roundTrip["gameMode"]; !ok {
		t.Errorf("gameMode field missing in JSON; got keys: %v", keysOf(roundTrip))
	}
	if roundTrip["gameMode"] != "civilization_relics" {
		t.Errorf("gameMode = %v, want civilization_relics", roundTrip["gameMode"])
	}
	if roundTrip["preferredCount"].(float64) != 4 {
		t.Errorf("preferredCount = %v, want 4", roundTrip["preferredCount"])
	}
}

// keysOf 返回 map 的键列表(测试辅助)。
func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
