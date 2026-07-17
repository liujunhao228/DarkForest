package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/semantic"
)

// card_detail_test.go 覆盖 Task 11 两个详情层 tool 的核心路径:
//   - get_card_detail    : Found / NotFound
//   - get_card_glossary  : ByType(4 种) / All(19 张)
//   - ToSimpleCard       : CardRole 映射(defense/energy/utility 四类)
//
// 静态查询 tool 不依赖 GameSession,handler 闭包传入 nil mgr 即可调用。

// TestGetCardDetail_Found 验证查询存在的 defId 时返回 Found=true 且 Card 字段完整。
func TestGetCardDetail_Found(t *testing.T) {
	handler := handleGetCardDetail(nil)
	_, out, err := handler(context.Background(), nil, GetCardDetailInput{DefID: "strike_thermal"})
	if err != nil {
		t.Fatalf("handler 返回错误: %v", err)
	}
	if !out.Found {
		t.Fatal("Found = false, want true")
	}
	if out.Card == nil {
		t.Fatal("Card = nil, want non-nil")
	}
	// 验证完整字段
	if out.Card.ID != "strike_thermal" {
		t.Errorf("Card.ID = %q, want %q", out.Card.ID, "strike_thermal")
	}
	if out.Card.Name != "热核打击" {
		t.Errorf("Card.Name = %q, want %q", out.Card.Name, "热核打击")
	}
	if out.Card.Type != "strike" {
		t.Errorf("Card.Type = %q, want %q", out.Card.Type, "strike")
	}
	if out.Card.Energy != 4 {
		t.Errorf("Card.Energy = %d, want 4", out.Card.Energy)
	}
	if out.Card.Quantity != 4 {
		t.Errorf("Card.Quantity = %d, want 4", out.Card.Quantity)
	}
	if out.Card.Description == "" {
		t.Error("Card.Description 为空, 应为非空")
	}
	if len(out.Card.Extended) == 0 {
		t.Error("Card.Extended 为空, 应为非空")
	}
	// 验证 Extended 字段内容(level=1, speed=1)
	if level, ok := out.Card.Extended["level"].(int); !ok || level != 1 {
		t.Errorf("Card.Extended[level] = %v, want int(1)", out.Card.Extended["level"])
	}
	if speed, ok := out.Card.Extended["speed"].(int); !ok || speed != 1 {
		t.Errorf("Card.Extended[speed] = %v, want int(1)", out.Card.Extended["speed"])
	}
}

// TestGetCardDetail_NotFound 验证查询不存在的 defId 时返回 Found=false 且 Card 为 nil。
func TestGetCardDetail_NotFound(t *testing.T) {
	handler := handleGetCardDetail(nil)
	_, out, err := handler(context.Background(), nil, GetCardDetailInput{DefID: "nonexistent_card"})
	if err != nil {
		t.Fatalf("handler 返回错误: %v", err)
	}
	if out.Found {
		t.Error("Found = true, want false")
	}
	if out.Card != nil {
		t.Errorf("Card = %v, want nil", out.Card)
	}
}

// TestGetCardDetail_FacilityExtended 验证设施卡的 Extended 字段(energy_per_turn/ability)完整返回。
func TestGetCardDetail_FacilityExtended(t *testing.T) {
	handler := handleGetCardDetail(nil)
	_, out, err := handler(context.Background(), nil, GetCardDetailInput{DefID: "facility_dyson_sphere"})
	if err != nil {
		t.Fatalf("handler 返回错误: %v", err)
	}
	if !out.Found {
		t.Fatal("Found = false, want true")
	}
	if ept, ok := out.Card.Extended["energy_per_turn"].(int); !ok || ept != 3 {
		t.Errorf("Extended[energy_per_turn] = %v, want int(3)", out.Card.Extended["energy_per_turn"])
	}
	if dur, ok := out.Card.Extended["duration"].(string); !ok || dur != "permanent" {
		t.Errorf("Extended[duration] = %v, want %q", out.Card.Extended["duration"], "permanent")
	}
}

// TestGetCardGlossary_ByType 验证按四种类型分别查询, 返回数量与卡牌定义一致。
func TestGetCardGlossary_ByType(t *testing.T) {
	cases := []struct {
		name      string
		cardType  string
		wantCount int
	}{
		{"broadcast", "broadcast", 6},
		{"strike", "strike", 5},
		{"defense", "defense", 2},
		{"facility", "facility", 6},
	}
	handler := handleGetCardGlossary(nil)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, out, err := handler(context.Background(), nil, GetCardGlossaryInput{Type: tc.cardType})
			if err != nil {
				t.Fatalf("handler 返回错误: %v", err)
			}
			if out.Total != tc.wantCount {
				t.Errorf("Total = %d, want %d", out.Total, tc.wantCount)
			}
			if len(out.Cards) != tc.wantCount {
				t.Errorf("len(Cards) = %d, want %d", len(out.Cards), tc.wantCount)
			}
			// 验证每张卡的 defId 前缀与查询类型一致
			for _, c := range out.Cards {
				if !strings.HasPrefix(c.DefID, tc.cardType+"_") {
					t.Errorf("Card.DefID = %q, 前缀应为 %q", c.DefID, tc.cardType+"_")
				}
			}
		})
	}
}

// TestGetCardGlossary_All 验证不传 type 时返回全部 19 张卡牌。
func TestGetCardGlossary_All(t *testing.T) {
	handler := handleGetCardGlossary(nil)
	_, out, err := handler(context.Background(), nil, GetCardGlossaryInput{Type: ""})
	if err != nil {
		t.Fatalf("handler 返回错误: %v", err)
	}
	if out.Total != 19 {
		t.Errorf("Total = %d, want 19", out.Total)
	}
	if len(out.Cards) != 19 {
		t.Errorf("len(Cards) = %d, want 19", len(out.Cards))
	}
	// 验证所有 SimpleCard 字段非空(DefID/Name/Role/Output 均应有值)
	for _, c := range out.Cards {
		if c.DefID == "" {
			t.Error("存在 DefID 为空的 SimpleCard")
		}
		if c.Name == "" {
			t.Errorf("DefID=%q 的 Name 为空", c.DefID)
		}
		if c.Role == "" {
			t.Errorf("DefID=%q 的 Role 为空", c.DefID)
		}
		if c.Output == "" {
			t.Errorf("DefID=%q 的 Output 为空", c.DefID)
		}
	}
}

// TestGetCardGlossary_InvalidType 验证传入无效类型时返回空列表(非报错)。
func TestGetCardGlossary_InvalidType(t *testing.T) {
	handler := handleGetCardGlossary(nil)
	_, out, err := handler(context.Background(), nil, GetCardGlossaryInput{Type: "invalid_type"})
	if err != nil {
		t.Fatalf("handler 返回错误: %v", err)
	}
	if out.Total != 0 {
		t.Errorf("Total = %d, want 0(无效类型应返回空)", out.Total)
	}
	if len(out.Cards) != 0 {
		t.Errorf("len(Cards) = %d, want 0", len(out.Cards))
	}
}

// TestToSimpleCard_RoleMapping 验证 CardRole 映射逻辑。
// 覆盖: defense→defense, facility→energy/utility, strike→utility, broadcast→utility。
func TestToSimpleCard_RoleMapping(t *testing.T) {
	cases := []struct {
		name     string
		defID    string
		wantRole semantic.CardRole
		wantSub  string // output 应包含的子串
	}{
		{"defense 掩体星环映射到 defense", "defense_shield_ring", semantic.CardRoleDefense, "防御Lv.2"},
		{"defense 量子幽灵映射到 defense", "defense_quantum_ghost", semantic.CardRoleDefense, "防御Lv.3"},
		{"facility 太阳能阵列映射到 energy", "facility_solar_array", semantic.CardRoleEnergy, "+1能量/回合"},
		{"facility 反物质引擎映射到 energy", "facility_antimatter_engine", semantic.CardRoleEnergy, "+2能量/回合"},
		{"facility 戴森球映射到 energy", "facility_dyson_sphere", semantic.CardRoleEnergy, "+3能量/回合"},
		{"facility 监听基地映射到 utility", "facility_monitoring_station", semantic.CardRoleUtility, "监听基地"},
		{"facility 光速飞船映射到 utility", "facility_lightspeed_ship", semantic.CardRoleUtility, "光速飞船"},
		{"strike 热核打击映射到 utility", "strike_thermal", semantic.CardRoleUtility, "打击Lv.1"},
		{"strike 降维打击映射到 utility", "strike_dimensional", semantic.CardRoleUtility, "打击Lv.4"},
		{"broadcast 恒星广播映射到 utility", "broadcast_star_cooperation", semantic.CardRoleUtility, "广播(距离1)"},
		{"broadcast 超距广播映射到 utility", "broadcast_ultra_cooperation", semantic.CardRoleUtility, "广播(距离1000)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			def, ok := semantic.GetCardDef(tc.defID)
			if !ok {
				t.Fatalf("GetCardDef(%q) 未找到", tc.defID)
			}
			sc := semantic.ToSimpleCard(def)
			if sc.Role != tc.wantRole {
				t.Errorf("Role = %q, want %q", sc.Role, tc.wantRole)
			}
			if !strings.Contains(sc.Output, tc.wantSub) {
				t.Errorf("Output = %q, 应包含 %q", sc.Output, tc.wantSub)
			}
			// 验证 SimpleCard 核心字段
			if sc.DefID != tc.defID {
				t.Errorf("DefID = %q, want %q", sc.DefID, tc.defID)
			}
			if sc.Name == "" {
				t.Error("Name 为空, 应为非空")
			}
		})
	}
}

// TestCardDetailOutputSchema_Generation 验证两个 Output 类型能成功生成 JSON Schema。
// 防止 jsonschema-go 反射失败导致 mcp.AddTool panic。
func TestCardDetailOutputSchema_Generation(t *testing.T) {
	t.Run("GetCardDetailOutput", func(t *testing.T) {
		s := outputSchemaFor[GetCardDetailOutput]()
		if s == nil {
			t.Fatal("outputSchemaFor[GetCardDetailOutput] returned nil")
		}
		data, err := json.Marshal(s)
		if err != nil {
			t.Fatalf("marshal schema: %v", err)
		}
		if len(data) == 0 {
			t.Error("schema marshalled to empty bytes")
		}
	})
	t.Run("GetCardGlossaryOutput", func(t *testing.T) {
		s := outputSchemaFor[GetCardGlossaryOutput]()
		if s == nil {
			t.Fatal("outputSchemaFor[GetCardGlossaryOutput] returned nil")
		}
		data, err := json.Marshal(s)
		if err != nil {
			t.Fatalf("marshal schema: %v", err)
		}
		if len(data) == 0 {
			t.Error("schema marshalled to empty bytes")
		}
	})
}

// TestCardLibrary_TotalDefinitions 验证卡牌定义总数为 19(与后端 cards.go 一致)。
func TestCardLibrary_TotalDefinitions(t *testing.T) {
	all := semantic.ListAllCardDefs()
	if len(all) != 19 {
		t.Errorf("ListAllCardDefs 返回 %d 张, want 19", len(all))
	}
	if semantic.TotalCardDefinitions != 19 {
		t.Errorf("TotalCardDefinitions = %d, want 19", semantic.TotalCardDefinitions)
	}
}
