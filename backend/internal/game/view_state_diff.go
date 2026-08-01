package game

import (
	"fmt"
	"reflect"
	"strings"
)

// Change 表示 ViewState 增量 diff 中的单个变更项。
type Change struct {
	Path  string      `json:"path"`
	Value interface{} `json:"value,omitempty"`
	Type  string      `json:"type"` // "set" 或 "delete"
}

// DiffViewStates 比较 prev 与 next 两个 ViewState，返回增量 Change 列表。
// 无差异时返回 nil（非空切片）。
//
// 递归 deep equality walk 规则：
//   - 标量字段直接比较，不同则产出 set change
//   - struct 字段递归，路径用 "." 连接
//   - 数组/切片按索引对齐比较（不尝试 reorder），路径用 "fieldName[index]" 表示
//   - 指针字段：nil→非 nil 产出 set；非 nil→nil 产出 delete
//   - Logs 字段特殊处理为 append-only
func DiffViewStates(prev, next *ViewState) []Change {
	if prev == nil && next == nil {
		return nil
	}
	if prev == nil {
		return []Change{{Path: "", Value: next, Type: "set"}}
	}
	if next == nil {
		return []Change{{Path: "", Type: "delete"}}
	}
	var changes []Change
	diffStruct("", reflect.ValueOf(*prev), reflect.ValueOf(*next), &changes)
	if len(changes) == 0 {
		return nil
	}
	return changes
}

// diffStruct 递归比较两个 struct 的字段，按 JSON tag 名作为路径段。
func diffStruct(prefix string, prevV, nextV reflect.Value, changes *[]Change) {
	t := prevV.Type()
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		jsonName := jsonFieldName(field)
		var path string
		if prefix == "" {
			path = jsonName
		} else {
			path = prefix + "." + jsonName
		}

		// Logs 字段特殊处理为 append-only
		if field.Name == "Logs" && field.Type == reflect.TypeOf([]LogEntry{}) {
			diffLogs(path, prevV.Field(i), nextV.Field(i), changes)
			continue
		}

		diffValue(path, prevV.Field(i), nextV.Field(i), changes)
	}
}

// diffValue 按类型分发比较两个 reflect.Value。
func diffValue(path string, prevV, nextV reflect.Value, changes *[]Change) {
	// 指针：处理 nil vs 非 nil
	if prevV.Kind() == reflect.Ptr {
		prevNil := prevV.IsNil()
		nextNil := nextV.IsNil()
		if prevNil && nextNil {
			return
		}
		if prevNil && !nextNil {
			*changes = append(*changes, Change{Path: path, Value: nextV.Interface(), Type: "set"})
			return
		}
		if !prevNil && nextNil {
			*changes = append(*changes, Change{Path: path, Type: "delete"})
			return
		}
		diffValue(path, prevV.Elem(), nextV.Elem(), changes)
		return
	}

	// struct：递归
	if prevV.Kind() == reflect.Struct {
		diffStruct(path, prevV, nextV, changes)
		return
	}

	// slice：按索引对齐
	if prevV.Kind() == reflect.Slice {
		diffSlice(path, prevV, nextV, changes)
		return
	}

	// 标量：直接比较
	if !reflect.DeepEqual(prevV.Interface(), nextV.Interface()) {
		*changes = append(*changes, Change{Path: path, Value: nextV.Interface(), Type: "set"})
	}
}

// diffSlice 按索引对齐比较两个 slice（不尝试 reorder）。
// nil 与非 nil 之间产出 set/delete；公共前缀逐元素递归；尾部新增/删除按索引产出 change。
func diffSlice(path string, prevV, nextV reflect.Value, changes *[]Change) {
	prevNil := prevV.IsNil()
	nextNil := nextV.IsNil()
	if prevNil && nextNil {
		return
	}
	if prevNil && !nextNil {
		*changes = append(*changes, Change{Path: path, Value: nextV.Interface(), Type: "set"})
		return
	}
	if !prevNil && nextNil {
		*changes = append(*changes, Change{Path: path, Type: "delete"})
		return
	}

	prevLen := prevV.Len()
	nextLen := nextV.Len()

	minLen := prevLen
	if nextLen < minLen {
		minLen = nextLen
	}

	for i := 0; i < minLen; i++ {
		diffValue(fmt.Sprintf("%s[%d]", path, i), prevV.Index(i), nextV.Index(i), changes)
	}

	// next 更长：新增元素产出 set
	for i := prevLen; i < nextLen; i++ {
		*changes = append(*changes, Change{
			Path:  fmt.Sprintf("%s[%d]", path, i),
			Value: nextV.Index(i).Interface(),
			Type:  "set",
		})
	}

	// prev 更长：尾部元素产出 delete
	for i := nextLen; i < prevLen; i++ {
		*changes = append(*changes, Change{
			Path: fmt.Sprintf("%s[%d]", path, i),
			Type: "delete",
		})
	}
}

// diffLogs 处理 Logs 字段的 append-only 语义：
//   - next 长度 >= prev 长度：仅产出 logs[N..M-1] 的 set change，不重发前 N 项
//   - next 长度 < prev 长度（日志缩短）：按普通数组处理（回退到 diffSlice）
func diffLogs(path string, prevV, nextV reflect.Value, changes *[]Change) {
	prevLen := prevV.Len()
	nextLen := nextV.Len()

	if nextLen >= prevLen {
		for i := prevLen; i < nextLen; i++ {
			*changes = append(*changes, Change{
				Path:  fmt.Sprintf("%s[%d]", path, i),
				Value: nextV.Index(i).Interface(),
				Type:  "set",
			})
		}
		return
	}

	// 日志缩短：按普通数组处理
	diffSlice(path, prevV, nextV, changes)
}

// jsonFieldName 从 struct field 的 json tag 提取字段名；无 tag 或 tag 为 "-" 时返回字段名本身。
func jsonFieldName(field reflect.StructField) string {
	tag := field.Tag.Get("json")
	if tag == "" || tag == "-" {
		return field.Name
	}
	parts := strings.Split(tag, ",")
	if parts[0] == "" {
		return field.Name
	}
	return parts[0]
}
