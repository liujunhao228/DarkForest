package semantic

import "fmt"

// card_library.go 是 MCP Server 侧的静态卡牌库,镜像后端 backend/internal/game/cards.go
// 的 19 张卡牌完整定义。与前端 frontend/src/lib/game/cards.ts 的镜像模式对齐。
//
// 设计理由:MCP Server 是独立进程,不能依赖后端运行时;硬编码镜像保证卡牌查询 tool
// (get_card_detail / get_card_glossary) 在无后端连接时仍可工作。
//
// 卡牌类型与后端 game.CardType 常量一致:
//   - broadcast : 广播卡(cooperation/disguise 两种 subtype)
//   - strike    : 打击卡(4 个 level + 科技锁死)
//   - defense   : 防御卡(掩体星环/量子幽灵)
//   - facility  : 设施卡(产能/监听/光速飞船)

// CardDefEntry 是卡牌完整定义(镜像后端 game.CardDef)。
// 字段与后端 backend/internal/game/types.go 的 CardDef 一一对应。
type CardDefEntry struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Type        string                 `json:"type"` // broadcast/strike/defense/facility
	Energy      int                    `json:"energy"`
	Quantity    int                    `json:"quantity"`
	Description string                 `json:"description"`
	Image       string                 `json:"image,omitempty"`
	Extended    map[string]interface{} `json:"extended,omitempty"`
}

// cardDefinitions 是 19 张卡牌的完整定义,镜像后端 backend/internal/game/cards.go。
// 顺序与后端一致:6 广播 + 5 打击 + 2 防御 + 6 设施 = 19 张定义,共 72 张物理牌。
//
// Image 字段在后端为空字符串,前端使用内联 SVG;此处保留空值以与后端对齐,
// 前端通过 CARD_IMAGE_MAP 自行映射 SVG 资源。
var cardDefinitions = []CardDefEntry{
	// --- 广播卡(6 张定义, 28 张物理牌) ---
	{
		ID:          "broadcast_star_cooperation",
		Name:        "恒星广播",
		Type:        "broadcast",
		Energy:      0,
		Quantity:    9,
		Description: "向距离 1 以内的星系发送广播信号，若对方回应且双方均选择合作，各获得 3 能量",
		Extended: map[string]interface{}{
			"subtype": "cooperation",
			"range":   1,
		},
	},
	{
		ID:          "broadcast_star_disguise",
		Name:        "恒星广播",
		Type:        "broadcast",
		Energy:      0,
		Quantity:    5,
		Description: "向距离 1 以内的星系发送广播信号，伪装方可获得 5 能量（若对方合作）",
		Extended: map[string]interface{}{
			"subtype": "disguise",
			"range":   1,
		},
	},
	{
		ID:          "broadcast_cosmic_cooperation",
		Name:        "宇宙广播",
		Type:        "broadcast",
		Energy:      1,
		Quantity:    6,
		Description: "向距离 2 以内的星系发送广播信号，若对方回应且双方均选择合作，各获得 3 能量",
		Extended: map[string]interface{}{
			"subtype": "cooperation",
			"range":   2,
		},
	},
	{
		ID:          "broadcast_cosmic_disguise",
		Name:        "宇宙广播",
		Type:        "broadcast",
		Energy:      1,
		Quantity:    4,
		Description: "向距离 2 以内的星系发送广播信号，伪装方可获得 5 能量（若对方合作）",
		Extended: map[string]interface{}{
			"subtype": "disguise",
			"range":   2,
		},
	},
	{
		ID:          "broadcast_ultra_cooperation",
		Name:        "超距广播",
		Type:        "broadcast",
		Energy:      2,
		Quantity:    2,
		Description: "无视距离发送广播信号，若对方回应且双方均选择合作，各获得 3 能量",
		Extended: map[string]interface{}{
			"subtype": "cooperation",
			"range":   1000,
		},
	},
	{
		ID:          "broadcast_ultra_disguise",
		Name:        "超距广播",
		Type:        "broadcast",
		Energy:      2,
		Quantity:    2,
		Description: "无视距离发送广播信号，伪装方可获得 5 能量（若对方合作）",
		Extended: map[string]interface{}{
			"subtype": "disguise",
			"range":   1000,
		},
	},
	// --- 打击卡(5 张定义, 17 张物理牌) ---
	{
		ID:          "strike_thermal",
		Name:        "热核打击",
		Type:        "strike",
		Energy:      4,
		Quantity:    4,
		Description: "打击无特殊效果，可被掩体星环防御",
		Extended: map[string]interface{}{
			"level": 1,
			"speed": 1,
		},
	},
	{
		ID:          "strike_light_particle",
		Name:        "光粒打击",
		Type:        "strike",
		Energy:      6,
		Quantity:    4,
		Description: "无论是否被防御，均毁灭目标星系恒星",
		Extended: map[string]interface{}{
			"level": 2,
			"speed": 1,
		},
	},
	{
		ID:          "strike_annihilation",
		Name:        "湮灭打击",
		Type:        "strike",
		Energy:      8,
		Quantity:    3,
		Description: "无论是否被防御，均毁灭目标星系恒星及所有建设牌",
		Extended: map[string]interface{}{
			"level": 3,
			"speed": 1,
		},
	},
	{
		ID:          "strike_dimensional",
		Name:        "降维打击",
		Type:        "strike",
		Energy:      10,
		Quantity:    3,
		Description: "彻底清除目标星系",
		Extended: map[string]interface{}{
			"level": 4,
			"speed": 1,
		},
	},
	{
		ID:          "strike_tech_lock",
		Name:        "科技锁死",
		Type:        "strike",
		Energy:      4,
		Quantity:    3,
		Description: "无视防御，打击生效时，目标玩家立即弃掉全部手牌",
		Extended: map[string]interface{}{
			"level":  4,
			"speed":  1,
			"effect": "discard_hand",
		},
	},
	// --- 防御卡(2 张定义, 8 张物理牌) ---
	{
		ID:          "defense_shield_ring",
		Name:        "掩体星环",
		Type:        "defense",
		Energy:      6,
		Quantity:    5,
		Description: "可在等级 2 及以下的打击中幸存，可防御热核打击、但不免除光粒打击的效果",
		Extended: map[string]interface{}{
			"protection_level": 2,
			"duration":         "permanent",
		},
	},
	{
		ID:          "defense_quantum_ghost",
		Name:        "量子幽灵",
		Type:        "defense",
		Energy:      8,
		Quantity:    3,
		Description: "进入量子幽灵态，可在等级 3 及以下的打击中幸存",
		Extended: map[string]interface{}{
			"protection_level": 3,
			"duration":         "permanent",
		},
	},
	// --- 设施卡(6 张定义, 19 张物理牌) ---
	{
		ID:          "facility_solar_array",
		Name:        "太阳能阵列",
		Type:        "facility",
		Energy:      2,
		Quantity:    5,
		Description: "每回合开始时获得 1 点能量产出，依赖恒星",
		Extended: map[string]interface{}{
			"energy_per_turn": 1,
			"duration":        "permanent",
		},
	},
	{
		ID:          "facility_fusion_reactor",
		Name:        "聚变反应堆",
		Type:        "facility",
		Energy:      3,
		Quantity:    4,
		Description: "每回合获得 1 点能量产出，不依赖恒星",
		Extended: map[string]interface{}{
			"energy_per_turn": 1,
			"duration":        "permanent",
		},
	},
	{
		ID:          "facility_antimatter_engine",
		Name:        "反物质引擎",
		Type:        "facility",
		Energy:      6,
		Quantity:    3,
		Description: "每回合获得 2 点能量产出，不依赖恒星",
		Extended: map[string]interface{}{
			"energy_per_turn": 2,
			"duration":        "permanent",
		},
	},
	{
		ID:          "facility_dyson_sphere",
		Name:        "戴森球",
		Type:        "facility",
		Energy:      6,
		Quantity:    3,
		Description: "每回合获得 3 点能量产出，依赖恒星，每个星系只能建造1个",
		Extended: map[string]interface{}{
			"energy_per_turn": 3,
			"duration":        "permanent",
		},
	},
	{
		ID:          "facility_monitoring_station",
		Name:        "监听基地",
		Type:        "facility",
		Energy:      2,
		Quantity:    2,
		Description: "所在星系接收广播后可不做回应",
		Extended: map[string]interface{}{
			"ability":  "detect_broadcast",
			"duration": "permanent",
		},
	},
	{
		ID:          "facility_lightspeed_ship",
		Name:        "光速飞船",
		Type:        "facility",
		Energy:      10,
		Quantity:    2,
		Description: "普通模式：一次性牌，从手牌直接跃迁，随机10能量（位置不公开）或指定13能量（位置公开），不可携带能量，无留言，跃迁后进弃牌堆；余下能量与设施可选遗留或销毁。文明遗迹模式：可重复使用，部署10能量后跃迁（随机3/指定5能量），可携带0-5能量，可留言（+1能量），飞船保留。",
		Extended: map[string]interface{}{
			"ability":  "escape",
			"duration": "permanent",
		},
	},
}

// TotalCardDefinitions 是卡牌定义总数(19 张)。
const TotalCardDefinitions = 19

// GetCardDef 按 defID 查找卡牌定义。找到返回 (entry, true),否则返回零值与 false。
func GetCardDef(defID string) (CardDefEntry, bool) {
	for i := range cardDefinitions {
		if cardDefinitions[i].ID == defID {
			return cardDefinitions[i], true
		}
	}
	return CardDefEntry{}, false
}

// ListCardDefsByType 按 type 过滤卡牌定义。cardType 为空时返回全部。
// cardType 取值: "broadcast" / "strike" / "defense" / "facility"。
func ListCardDefsByType(cardType string) []CardDefEntry {
	if cardType == "" {
		return ListAllCardDefs()
	}
	out := make([]CardDefEntry, 0)
	for i := range cardDefinitions {
		if cardDefinitions[i].Type == cardType {
			out = append(out, cardDefinitions[i])
		}
	}
	return out
}

// ListAllCardDefs 返回全部 19 张卡牌定义的副本。
func ListAllCardDefs() []CardDefEntry {
	out := make([]CardDefEntry, len(cardDefinitions))
	copy(out, cardDefinitions)
	return out
}

// ToSimpleCard 把 CardDefEntry 转换为 SimpleCard(glossary 输出用)。
//
// 角色映射规则与 object_projector.go 的 classifyCard 保持一致:
//   - defense:                              role=defense,  output="防御Lv.{protectionLevel}"
//   - facility, energy_per_turn > 0:        role=energy,   output="+{N}能量/回合"
//   - facility, ability=detect_broadcast:   role=utility,  output="监听基地"
//   - facility, ability=escape:             role=utility,  output="光速飞船"
//   - facility, ability=其他:               role=utility,  output=ability 值
//   - facility, 无 ability:                 role=utility,  output="未知"
//   - strike:                               role=utility,  output="打击Lv.{level}"
//   - broadcast:                            role=utility,  output="广播(距离{range})"
//
// 说明:strike / broadcast 不属于设施三类(energy/defense/utility),统一归为 utility。
// FaceUpCards 不会出现 strike/broadcast,但 glossary tool 会浏览全部卡牌,
// 故为 strike/broadcast 提供可读的 output 摘要(level / range)。
func ToSimpleCard(def CardDefEntry) SimpleCard {
	role, output := classifyDefEntry(def)
	return SimpleCard{
		DefID:  def.ID,
		Name:   def.Name,
		Role:   role,
		Output: output,
	}
}

// classifyDefEntry 按 Type + Extended 字段把 CardDefEntry 映射到 (role, output)。
// 与 object_projector.go 的 classifyCard 逻辑等价,但数据源是 CardDefEntry.Extended
// 而非 gamesdk.Card 的强类型字段。
func classifyDefEntry(def CardDefEntry) (CardRole, string) {
	switch def.Type {
	case "defense":
		return CardRoleDefense, fmt.Sprintf("防御Lv.%d", extInt(def.Extended, "protection_level"))
	case "facility":
		if ept := extInt(def.Extended, "energy_per_turn"); ept > 0 {
			return CardRoleEnergy, fmt.Sprintf("+%d能量/回合", ept)
		}
		if ability := extStr(def.Extended, "ability"); ability != "" {
			switch ability {
			case "detect_broadcast":
				return CardRoleUtility, "监听基地"
			case "escape":
				return CardRoleUtility, "光速飞船"
			default:
				return CardRoleUtility, ability
			}
		}
		return CardRoleUtility, "未知"
	case "strike":
		return CardRoleUtility, fmt.Sprintf("打击Lv.%d", extInt(def.Extended, "level"))
	case "broadcast":
		return CardRoleUtility, fmt.Sprintf("广播(距离%d)", extInt(def.Extended, "range"))
	default:
		return CardRoleUtility, ""
	}
}

// extInt 从 Extended map 中读取 int 值,键不存在或类型不匹配时返回 0。
// 支持 int / int64 / float64 三种数值类型(镜像后端 JSON 反序列化可能的类型)。
func extInt(m map[string]interface{}, key string) int {
	if m == nil {
		return 0
	}
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

// extStr 从 Extended map 中读取 string 值,键不存在或类型不匹配时返回空串。
func extStr(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
