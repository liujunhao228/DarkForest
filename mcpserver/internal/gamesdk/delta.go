package gamesdk

// delta.go 实现 game:deltaSync 增量同步的载荷类型与路径应用逻辑。
//
// 后端在正常对局中优先发送 game:deltaSync(rooms/room.go buildDeltaSyncMessage),
// 仅 cache miss / 版本断档时发送 game:fullSync。MCP 必须像前端一样消费增量,
// 否则 gameState 会在首个对手动作后过期,导致 Agent 基于陈旧状态决策。
//
// 路径(Path)格式与后端 game.view_state_diff 一致:
//   - 对象属性用点连接: "totalTurn" / "players.0.energy"
//   - 数组元素用方括号: "players[0].hand" / "logs[2]"
//
// 应用语义镜像前端 src/store/onlineGameStore/sync.ts:
//   - set 优先, delete 按路径(索引)降序
//   - 对象属性 delete -> 置 nil(null);数组元素 delete -> 移除元素
//
// 安全说明:ViewState 已由后端按观察者脱敏(per-viewer diff),此处不做二次白名单,
// 仅按路径机械应用,与前端纵深防御职责不同(MCP 状态只供 Agent 读取,不渲染给用户)。

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

// Change 是增量更新中的单个变更项,镜像后端 game.view_state_diff.Change。
type Change struct {
	Path  string `json:"path"`
	Value any    `json:"value,omitempty"`
	Type  string `json:"type"` // "set" 或 "delete"
}

// DeltaSyncPayload 是 game:deltaSync 的载荷,镜像后端 room.buildDeltaSyncMessage。
type DeltaSyncPayload struct {
	Changes   []Change `json:"changes"`
	Version   int      `json:"version"`
	Timestamp int64    `json:"timestamp"`
}

// applyChanges 把一组增量变更应用到 ViewState,返回应用后的新副本(不修改入参)。
func applyChanges(state *ViewState, changes []Change) *ViewState {
	data, err := json.Marshal(state)
	if err != nil {
		return state
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return state
	}
	applyChangeList(m, changes)
	out, err := json.Marshal(m)
	if err != nil {
		return state
	}
	var next ViewState
	if err := json.Unmarshal(out, &next); err != nil {
		return state
	}
	return &next
}

// applyChangeList 按 set -> delete(索引降序)顺序应用变更。
// 同数组内多个 delete 按索引降序处理,避免 splice 后索引偏移。
func applyChangeList(root map[string]any, changes []Change) {
	for _, c := range changes {
		if c.Type != "delete" {
			setPathValue(root, c.Path, c.Value)
		}
	}
	var deletes []Change
	for _, c := range changes {
		if c.Type == "delete" {
			deletes = append(deletes, c)
		}
	}
	sort.SliceStable(deletes, func(i, j int) bool {
		return deletePathKey(deletes[i].Path) > deletePathKey(deletes[j].Path)
	})
	for _, c := range deletes {
		deletePathValue(root, c.Path)
	}
}

// deletePathKey 把路径转成"数字降序"排序键。
// 数组索引补零到 8 位,使字符串降序 == 数值降序(同数组内高索引先删)。
func deletePathKey(path string) string {
	var sb strings.Builder
	for _, part := range strings.Split(path, ".") {
		name, idx, ok := parseIndex(part)
		if ok {
			sb.WriteString(name)
			sb.WriteString(sprintfIndex(idx))
		} else {
			sb.WriteString(part)
		}
		sb.WriteString(".")
	}
	return sb.String()
}

// sprintfIndex 把索引格式化为定宽十进制(补零到 8 位)。
func sprintfIndex(idx int) string {
	s := strconv.Itoa(idx)
	if len(s) >= 8 {
		return s
	}
	return strings.Repeat("0", 8-len(s)) + s
}

// setPathValue 设置指定路径的值。数组索引段会自动创建中间结构。
func setPathValue(root map[string]any, path string, value any) {
	parts := strings.Split(path, ".")
	current := root
	for i := 0; i < len(parts)-1; i++ {
		name, idx, isIndex := parseIndex(parts[i])
		if isIndex {
			arr := growArray(current, name, idx)
			current = asObject(arr[idx])
		} else {
			current = asObject(current[name])
		}
	}
	last := parts[len(parts)-1]
	if name, idx, isIndex := parseIndex(last); isIndex {
		arr := growArray(current, name, idx)
		arr[idx] = value
		return
	}
	current[last] = value
}

// growArray 确保 current[name] 是长度 >= idx+1 的 []any,返回该切片。
// 若中间有空位用 map 占位,保证 JSON 序列化得到数组而非 null。
func growArray(current map[string]any, name string, idx int) []any {
	arr, _ := current[name].([]any)
	if arr == nil {
		arr = make([]any, 0, idx+1)
	}
	for len(arr) <= idx {
		arr = append(arr, map[string]any{})
	}
	current[name] = arr
	return arr
}

// asObject 把 any 归一化为 map[string]any(非 map 时返回空 map)。
func asObject(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// deletePathValue 删除指定路径的属性或数组元素。
//   - 对象属性: 置为 null(与 JSON 序列化语义一致)
//   - 数组元素: splice 移除(避免留下 undefined/null 元素)
func deletePathValue(root map[string]any, path string) {
	parts := strings.Split(path, ".")
	current := root
	for i := 0; i < len(parts)-1; i++ {
		name, idx, isIndex := parseIndex(parts[i])
		if isIndex {
			arr, ok := current[name].([]any)
			if !ok || idx < 0 || idx >= len(arr) {
				return
			}
			sub, ok := arr[idx].(map[string]any)
			if !ok {
				return
			}
			current = sub
		} else {
			sub, ok := current[name].(map[string]any)
			if !ok {
				return
			}
			current = sub
		}
	}
	last := parts[len(parts)-1]
	if name, idx, isIndex := parseIndex(last); isIndex {
		if arr, ok := current[name].([]any); ok && idx >= 0 && idx < len(arr) {
			current[name] = append(arr[:idx], arr[idx+1:]...)
		}
		return
	}
	current[last] = nil
}

// parseIndex 解析形如 "name[i]"(数组)或 "name" 的路径段。
// 返回 (字段名, 索引, 是否数组索引)。
func parseIndex(seg string) (string, int, bool) {
	if i := strings.IndexByte(seg, '['); i > 0 && strings.HasSuffix(seg, "]") {
		if idx, err := strconv.Atoi(seg[i+1 : len(seg)-1]); err == nil {
			return seg[:i], idx, true
		}
	}
	return seg, 0, false
}
