package game

import "math/rand"

// 预设遗迹强度档位常量。
// "空" 档（RelicStrengthEmpty）由"无遗迹组合"表示，即不产生 StarLeftover 记录。
const (
	RelicStrengthEmpty  = 0
	RelicStrengthWeak   = 1
	RelicStrengthMedium = 2
	RelicStrengthStrong = 3
)

// RelicCombo 描述一个预设的"遗迹组合"，在「文明遗迹」模式初始化时
// 按强度档概率分布到非起始星球上。继承者继承时获得其中的能量与设施。
type RelicCombo struct {
	ID         string
	Name       string
	Lore       string // 背景介绍（中文），契合「黑暗森林」世界观
	Strength   int    // 0=空/1=弱/2=中/3=强
	Energy     int
	Facilities []Card
}

// RelicCombos 是预设遗迹组合库，覆盖 弱/中/强 三档（共 11 个组合）。
// "空"档不在此列表中——空以"无组合"表示，调用方应判断零值。
var RelicCombos = []RelicCombo{
	// ===== 弱（RelicStrengthWeak）：低能量 + 1 个设施 =====
	{
		ID:         "relic_weak_signal_dust",
		Name:       "信号尘埃",
		Lore:       "一颗早已熄灭的文明在临终前发出的微弱电波残余，散落在沙暴般的星际尘埃里。捕获者偶尔能拼出只言片语的求救信。",
		Strength:   RelicStrengthWeak,
		Energy:     1,
		Facilities: []Card{cardByID("facility_solar_array")},
	},
	{
		ID:         "relic_weak_dormant_array",
		Name:       "沉睡阵列",
		Lore:       "废弃的太阳能阵列仍朝向一颗早已死亡的恒星缓慢转动，积蓄的能量勉强够点亮一盏孤灯。",
		Strength:   RelicStrengthWeak,
		Energy:     2,
		Facilities: []Card{cardByID("facility_fusion_reactor")},
	},
	{
		ID:         "relic_weak_whisper_dish",
		Name:       "低语之碟",
		Lore:       "监听基地的残骸里，电磁记录装置仍在循环播放一段无法解读的低语，似乎是某个文明在黑暗森林边缘最后的呢喃。",
		Strength:   RelicStrengthWeak,
		Energy:     1,
		Facilities: []Card{cardByID("facility_monitoring_station")},
	},
	{
		ID:         "relic_weak_fragment_records",
		Name:       "残章断简",
		Lore:       "一段被辐射风化得残缺不全的文明档案，其中残留的太阳能技术图样仍可勉强复原。",
		Strength:   RelicStrengthWeak,
		Energy:     2,
		Facilities: []Card{cardByID("facility_solar_array")},
	},

	// ===== 中（RelicStrengthMedium）：中等能量 + 1-2 个设施 =====
	{
		ID:         "relic_mid_derelict_reactor",
		Name:       "废弃反应堆",
		Lore:       "一座被遗弃的反物质引擎仍在低功率运转，冷却管道上凝着亿万年的霜。任何靠近者都能感到皮肤上的静电。",
		Strength:   RelicStrengthMedium,
		Energy:     4,
		Facilities: []Card{cardByID("facility_antimatter_engine")},
	},
	{
		ID:         "relic_mid_observers_ruin",
		Name:       "观星者遗址",
		Lore:       "古老的观星者在此布下监听阵列与太阳能补给站，试图捕捉黑暗森林中的脚步声。他们消失得无声无息，只留下这些沉默的耳目。",
		Strength:   RelicStrengthMedium,
		Energy:     3,
		Facilities: []Card{
			cardByID("facility_monitoring_station"),
			cardByID("facility_solar_array"),
		},
	},
	{
		ID:         "relic_mid_echo_chamber",
		Name:       "回响舱室",
		Lore:       "一座聚变反应堆的废弃舱室里回响着古老的广播频段，传说捕获者能听到自己未来的回音——只是从未有人证实。",
		Strength:   RelicStrengthMedium,
		Energy:     5,
		Facilities: []Card{cardByID("facility_fusion_reactor")},
	},
	{
		ID:         "relic_mid_shattered_dish",
		Name:       "破碎监听阵",
		Lore:       "陨石击碎了半数监听碟，但残存的阵列与备用聚变堆仍能拼凑出一段断续的星际窃听记录。",
		Strength:   RelicStrengthMedium,
		Energy:     4,
		Facilities: []Card{
			cardByID("facility_monitoring_station"),
			cardByID("facility_fusion_reactor"),
		},
	},

	// ===== 强（RelicStrengthStrong）：高能量 + 2-3 个设施 =====
	{
		ID:         "relic_strong_dyson_tomb",
		Name:       "戴森之墓",
		Lore:       "一颗戴森球笼罩着早已熄灭的恒星，建造它的文明在工程完成的同一刻被未知力量抹除。球壳上仍残留着温热的能量储备和一台无人值守的监听装置。",
		Strength:   RelicStrengthStrong,
		Energy:     8,
		Facilities: []Card{
			cardByID("facility_dyson_sphere"),
			cardByID("facility_monitoring_station"),
		},
	},
	{
		ID:         "relic_strong_antimatter_vault",
		Name:       "反物质秘窟",
		Lore:       "深藏于死星地幔下的反物质储藏室，由一台反物质引擎与聚变堆双重供能。开启它的文明留下了刻在金属门上的警告：'不要让它看见你'。",
		Strength:   RelicStrengthStrong,
		Energy:     10,
		Facilities: []Card{
			cardByID("facility_antimatter_engine"),
			cardByID("facility_fusion_reactor"),
		},
	},
	{
		ID:         "relic_strong_citadel_of_silence",
		Name:       "寂静堡垒",
		Lore:       "一座由戴森球、反物质引擎与监听基地共同支撑的末日堡垒。建造者笃信'黑暗森林'的终极真相，最终选择在沉默中蒸发，只留下这些机器继续守望。",
		Strength:   RelicStrengthStrong,
		Energy:     12,
		Facilities: []Card{
			cardByID("facility_dyson_sphere"),
			cardByID("facility_antimatter_engine"),
			cardByID("facility_monitoring_station"),
		},
	},
}

// CombosByStrength 返回指定强度档的全部预设遗迹组合。
// 对于 RelicStrengthEmpty 或未知档位，返回 nil。
func CombosByStrength(strength int) []RelicCombo {
	if strength == RelicStrengthEmpty {
		return nil
	}
	var result []RelicCombo
	for _, c := range RelicCombos {
		if c.Strength == strength {
			result = append(result, c)
		}
	}
	return result
}

// PickComboByStrength 在指定强度档中随机选取一个预设遗迹组合。
// 对于 RelicStrengthEmpty，或该档不存在任何组合时，返回零值 RelicCombo；
// 调用方应将零值视为"无遗留物"。
func PickComboByStrength(strength int) RelicCombo {
	combos := CombosByStrength(strength)
	if len(combos) == 0 {
		return RelicCombo{}
	}
	return combos[rand.Intn(len(combos))]
}

// cardByID 根据 CardDef 的 ID 构造一个新的 Card 实例。
// 复用 createCardInstances 以保留全部 Extended 字段映射逻辑，不重复卡牌定义。
// 若指定 ID 在 CardDefinitions 中不存在，返回零值 Card。
func cardByID(id string) Card {
	for _, def := range CardDefinitions {
		if def.ID == id {
			instances := createCardInstances(def)
			if len(instances) > 0 {
				return instances[0]
			}
			break
		}
	}
	return Card{}
}
