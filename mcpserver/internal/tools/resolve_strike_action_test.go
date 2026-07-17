package tools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// resolve_strike_action_test.go 覆盖 Task 10 的 6 种 option 分派逻辑。
//
// 测试策略说明:
// 由于 GameSession 是具体类型非接口(见 session.Manager.GetOrCreate 返回 *gamesdk.GameSession),
// 难以 mock,这里采用与 agent_view_test.go 类似的轻量测试策略:
//   - 提取纯函数 buildStrikeActionRequest(option, input) 承载分派逻辑
//   - 单测直接调用该纯函数,断言 action 名/payload 字段/校验错误
//   - Schema 生成测试覆盖 Input 的 enum 完整性与 Output 字段完整性
// handler 的端到端路径(连后端→SendAction)留给集成测试。

// TestResolveStrikeAction_BuildActionRequest 覆盖 6 种 option 的分派逻辑,
// 含合法路径、字段缺失校验、TargetSystem=0 显式传值、未知 option。
func TestResolveStrikeAction_BuildActionRequest(t *testing.T) {
	// 预先构造 *int 值,避免在 struct literal 中取地址字面量。
	sys0 := 0
	sys3 := 3
	sys9 := 9

	cases := []struct {
		name       string
		input      ResolveStrikeActionInput
		wantAction string
		wantData   map[string]any
		wantErr    string // 非空表示期望报错信息包含此子串
	}{
		// --- move ---
		{
			name:       "move 合法",
			input:      ResolveStrikeActionInput{Option: "move", StrikeUID: "s1", TargetSystem: &sys3},
			wantAction: "moveStrike",
			wantData:   map[string]any{"strikeUid": "s1", "targetSystem": 3},
		},
		{
			name:       "move targetSystem=0 显式传值",
			input:      ResolveStrikeActionInput{Option: "move", StrikeUID: "s1", TargetSystem: &sys0},
			wantAction: "moveStrike",
			wantData:   map[string]any{"strikeUid": "s1", "targetSystem": 0},
		},
		{
			name:    "move 缺 strikeUid",
			input:   ResolveStrikeActionInput{Option: "move", TargetSystem: &sys3},
			wantErr: "缺少 strikeUid",
		},
		{
			name:    "move 缺 targetSystem",
			input:   ResolveStrikeActionInput{Option: "move", StrikeUID: "s1"},
			wantErr: "缺少 targetSystem",
		},
		// --- retarget ---
		{
			name:       "retarget 合法",
			input:      ResolveStrikeActionInput{Option: "retarget", StrikeUID: "s2", TargetSystem: &sys9},
			wantAction: "retargetStrike",
			wantData:   map[string]any{"strikeUid": "s2", "targetSystem": 9},
		},
		{
			name:       "retarget targetSystem=0 显式传值",
			input:      ResolveStrikeActionInput{Option: "retarget", StrikeUID: "s2", TargetSystem: &sys0},
			wantAction: "retargetStrike",
			wantData:   map[string]any{"strikeUid": "s2", "targetSystem": 0},
		},
		{
			name:    "retarget 缺 strikeUid",
			input:   ResolveStrikeActionInput{Option: "retarget", TargetSystem: &sys3},
			wantErr: "缺少 strikeUid",
		},
		{
			name:    "retarget 缺 targetSystem",
			input:   ResolveStrikeActionInput{Option: "retarget", StrikeUID: "s2"},
			wantErr: "缺少 targetSystem",
		},
		// --- select ---
		{
			name:       "select 合法",
			input:      ResolveStrikeActionInput{Option: "select", StrikeUID: "s3"},
			wantAction: "selectStrike",
			wantData:   map[string]any{"strikeUid": "s3"},
		},
		{
			name:    "select 缺 strikeUid",
			input:   ResolveStrikeActionInput{Option: "select"},
			wantErr: "缺少 strikeUid",
		},
		// --- skip_select ---
		{
			name:       "skip_select 合法",
			input:      ResolveStrikeActionInput{Option: "skip_select"},
			wantAction: "skipStrikeSelect",
			wantData:   nil,
		},
		// --- announce ---
		{
			name:       "announce 合法",
			input:      ResolveStrikeActionInput{Option: "announce"},
			wantAction: "announceStrike",
			wantData:   nil,
		},
		// --- skip_announce ---
		{
			name:       "skip_announce 合法",
			input:      ResolveStrikeActionInput{Option: "skip_announce"},
			wantAction: "skipAnnounceStrike",
			wantData:   nil,
		},
		// --- 未知 option ---
		{
			name:    "未知 option 报错",
			input:   ResolveStrikeActionInput{Option: "foobar"},
			wantErr: "未知 option",
		},
		{
			name:    "空 option 报错",
			input:   ResolveStrikeActionInput{Option: ""},
			wantErr: "未知 option",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			action, data, err := buildStrikeActionRequest(tc.input.Option, tc.input)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("期望报错包含 %q, 实际无错 (action=%s data=%v)", tc.wantErr, action, data)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("错误信息 %q 不包含期望子串 %q", err.Error(), tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("未期望报错: %v", err)
			}
			if action != tc.wantAction {
				t.Errorf("action = %q, want %q", action, tc.wantAction)
			}
			if !mapEqual(data, tc.wantData) {
				t.Errorf("data = %v, want %v", data, tc.wantData)
			}
		})
	}
}

// TestResolveStrikeActionInput_OptionEnumSchema 验证 buildResolveStrikeActionInputSchema
// 返回的 schema 中:
//   - option 字段枚举完整(6 个合法值都出现在 enum 中)
//   - option 字段被标记为 required
//
// 由于 jsonschema-go v0.4.3 不支持 tag 中的 enum 关键字, enum 由
// buildResolveStrikeActionInputSchema 手动注入, 此测试验证注入成功。
func TestResolveStrikeActionInput_OptionEnumSchema(t *testing.T) {
	schema := buildResolveStrikeActionInputSchema()
	if schema == nil {
		t.Fatal("buildResolveStrikeActionInputSchema returned nil")
	}
	schemaBytes, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("marshal schema 失败: %v", err)
	}
	t.Logf("ResolveStrikeActionInput schema: %s", schemaBytes)

	// 1. 验证 option 字段存在
	optionProp, ok := schema.Properties["option"]
	if !ok {
		t.Fatal("schema.Properties 缺少 option 字段")
	}
	// 2. 验证 enum 包含 6 个合法值
	wantEnums := []string{"move", "retarget", "select", "skip_select", "announce", "skip_announce"}
	if len(optionProp.Enum) != len(wantEnums) {
		t.Fatalf("option.Enum 长度 = %d, want %d (got: %v)", len(optionProp.Enum), len(wantEnums), optionProp.Enum)
	}
	gotEnums := make(map[string]bool, len(optionProp.Enum))
	for _, e := range optionProp.Enum {
		s, ok := e.(string)
		if !ok {
			t.Errorf("option.Enum 含非 string 值: %T(%v)", e, e)
			continue
		}
		gotEnums[s] = true
	}
	for _, want := range wantEnums {
		if !gotEnums[want] {
			t.Errorf("option.Enum 缺少值 %q, 实际: %v", want, optionProp.Enum)
		}
	}
	// 3. 验证 option 在 Required 列表中(因无 omitempty 自动加入)
	required := false
	for _, r := range schema.Required {
		if r == "option" {
			required = true
			break
		}
	}
	if !required {
		t.Errorf("option 未出现在 schema.Required 中, Required=%v", schema.Required)
	}
	// 4. 验证 strikeUid/targetSystem 不在 Required 中(因有 omitempty)
	for _, r := range schema.Required {
		if r == "strikeUid" {
			t.Errorf("strikeUid 不应出现在 Required 中(有 omitempty)")
		}
		if r == "targetSystem" {
			t.Errorf("targetSystem 不应出现在 Required 中(有 omitempty)")
		}
	}
}

// TestResolveStrikeActionOutput_SchemaGeneration 验证 Output 的 schema 能
// 正确生成不 panic, 且包含全部期望字段。
func TestResolveStrikeActionOutput_SchemaGeneration(t *testing.T) {
	schema := outputSchemaFor[ResolveStrikeActionOutput]()
	if schema == nil {
		t.Fatal("outputSchemaFor[ResolveStrikeActionOutput] returned nil")
	}
	schemaBytes, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("marshal schema 失败: %v", err)
	}
	schemaStr := string(schemaBytes)
	wantFields := []string{"success", "option", "action", "requestId", "error", "errorCode"}
	for _, f := range wantFields {
		needle := "\"" + f + "\""
		if !strings.Contains(schemaStr, needle) {
			t.Errorf("schema 缺少字段 %q", f)
		}
	}
}

// TestResolveStrikeActionInput_JSONRoundTrip 验证 TargetSystem 用 *int 时
// JSON 序列化/反序列化的行为: 省略字段→nil, 显式 0→*int==0。
// 这是 *int 设计意图的关键验证(避免 omitempty 漏传 0)。
func TestResolveStrikeActionInput_JSONRoundTrip(t *testing.T) {
	sys0 := 0
	// 显式传 targetSystem=0
	in := ResolveStrikeActionInput{
		Option:       "move",
		StrikeUID:    "s1",
		TargetSystem: &sys0,
	}
	data, err := json.Marshal(in)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	// 反序列化回新变量, 验证 TargetSystem 非 nil 且值为 0
	var out ResolveStrikeActionInput
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal 失败: %v", err)
	}
	if out.TargetSystem == nil {
		t.Fatal("TargetSystem 反序列化为 nil, 期望 *int==0")
	}
	if *out.TargetSystem != 0 {
		t.Errorf("TargetSystem = %d, want 0", *out.TargetSystem)
	}

	// 省略 targetSystem 的场景: JSON 中不含该字段, 反序列化后应为 nil
	const jsonWithoutTarget = `{"option":"skip_select"}`
	var out2 ResolveStrikeActionInput
	if err := json.Unmarshal([]byte(jsonWithoutTarget), &out2); err != nil {
		t.Fatalf("unmarshal skip_select 失败: %v", err)
	}
	if out2.TargetSystem != nil {
		t.Errorf("skip_select 场景 TargetSystem 期望 nil, 实际 *int=%d", *out2.TargetSystem)
	}
}

// mapEqual 比较两个 map[string]any 是否深度相等。
// 将 nil map 与空 map 视为相等(两者在 JSON 序列化时表现一致)。
func mapEqual(a, b map[string]any) bool {
	if len(a) == 0 && len(b) == 0 {
		return true
	}
	return reflect.DeepEqual(a, b)
}
