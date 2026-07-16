package game

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"golang.org/x/text/unicode/norm"
)

//go:embed sensitive_words.json
var sensitiveWordsJSON []byte

// normalizedWord 保存敏感词的原始形式与归一化形式。
// 原始形式用于 HTTP 暴露，归一化形式用于内部匹配比对。
type normalizedWord struct {
	original   string
	normalized string
}

var (
	sensitiveWords  []string         // 原始词表（保留原文，用于 HTTP 暴露）
	normalizedWords []normalizedWord // 预归一化并按 rune 长度降序排序的匹配词表
)

func init() {
	if err := json.Unmarshal(sensitiveWordsJSON, &sensitiveWords); err != nil {
		panic(fmt.Sprintf("加载敏感词表失败: %v", err))
	}
	buildNormalizedWords()
}

// buildNormalizedWords 根据原始词表构建预归一化、按 rune 长度降序排序的匹配词表。
// 长词优先匹配，避免短词截断长词（例如 "违禁品m" 与 "违禁品"）。
func buildNormalizedWords() {
	normalizedWords = make([]normalizedWord, len(sensitiveWords))
	for i, w := range sensitiveWords {
		normalizedWords[i] = normalizedWord{
			original:   w,
			normalized: normalizeForMatch(w),
		}
	}
	sort.Slice(normalizedWords, func(i, j int) bool {
		ri := len([]rune(normalizedWords[i].normalized))
		rj := len([]rune(normalizedWords[j].normalized))
		return ri > rj
	})
}

// GetSensitiveWords 返回原始词表的副本，用于 HTTP API 暴露。
// 修改返回的切片不会影响内部状态。
func GetSensitiveWords() []string {
	out := make([]string, len(sensitiveWords))
	copy(out, sensitiveWords)
	return out
}

// ReloadWords 预留用于未来热更新词表。
// 当前为占位实现：//go:embed 文件在编译时固定，无法运行时重新加载。
func ReloadWords() {
	// TODO: 未来支持从外部文件或数据库热加载词表
}

// SanitizeContext 表示文本净化的上下文，决定命中后的策略（拒绝或掩码）。
type SanitizeContext int

const (
	SanitizeContextDisplayName SanitizeContext = iota
	SanitizeContextQueueName
	SanitizeContextChatMessage
)

// shouldKeepForMatch 判断归一化后的 rune 是否应保留用于匹配。
// 移除零宽字符、ASCII 空白、全角空格、ASCII 标点。
func shouldKeepForMatch(r rune) bool {
	switch r {
	case '\u200B', '\u200C', '\u200D', '\uFEFF': // ZWSP, ZWNJ, ZWJ, BOM
		return false
	case ' ', '\t', '\n', '\r', '\v', '\f': // ASCII 空白
		return false
	case '\u3000': // 全角空格
		return false
	}
	// ASCII 标点范围：!-/、:-@、[-`、{-~
	if (r >= '!' && r <= '/') ||
		(r >= ':' && r <= '@') ||
		(r >= '[' && r <= '`') ||
		(r >= '{' && r <= '~') {
		return false
	}
	return true
}

// normalizeForMatchWithMap 对输入做归一化处理，同时构建归一化 rune 索引到原始 rune 索引的映射。
// 归一化步骤：逐 rune NFKC → 转小写 → 过滤零宽/空白/标点。
// 返回归一化字符串与映射表（normToOrig[i] = 归一化后第 i 个 rune 对应的原始 rune 索引）。
// 逐 rune NFKC 是为实现位置映射；对当前词表（纯 ASCII/CJK）与整串 NFKC 结果一致。
func normalizeForMatchWithMap(s string) (string, []int) {
	var normBuilder strings.Builder
	var normToOrig []int
	runes := []rune(s)
	for origIdx, r := range runes {
		nfkc := norm.NFKC.String(string(r))
		lower := strings.ToLower(nfkc)
		for _, lr := range lower {
			if shouldKeepForMatch(lr) {
				normBuilder.WriteRune(lr)
				normToOrig = append(normToOrig, origIdx)
			}
		}
	}
	return normBuilder.String(), normToOrig
}

// normalizeForMatch 对输入做归一化处理，仅用于内部匹配比对，不修改原文展示。
// 归一化步骤：
//  1. Unicode NFKC 归一化（如全角 → 半角）
//  2. strings.ToLower 转小写
//  3. 去除零宽字符（U+200B/ZWSP、U+200C/ZWNJ、U+200D/ZWJ、U+FEFF/BOM）
//  4. 去除 ASCII 空白（空格、\t、\n、\r、\v、\f）与全角空格 U+3000
//  5. 去除 ASCII 标点（!-/、:-@、[-`、{-~）
func normalizeForMatch(s string) string {
	norm, _ := normalizeForMatchWithMap(s)
	return norm
}

// SanitizeUserText 是敏感词处理的统一入口。
// 根据上下文 ctx 决定命中后的策略：
//   - DisplayName / QueueName：命中即拒绝，返回 ("", error)
//   - ChatMessage：命中即掩码，将原文中命中区间替换为 "***" 后返回
//
// 空输入直接返回 ("", nil)。无命中返回原文。
// 匹配在归一化后的字符串上进行，但掩码作用于原始输入，
// 通过 normToOrig 映射表将归一化命中区间还原到原始 rune 区间，确保绕过字符也被覆盖。
func SanitizeUserText(text string, ctx SanitizeContext) (string, error) {
	if text == "" {
		return "", nil
	}

	normalized, normToOrig := normalizeForMatchWithMap(text)
	normRunes := []rune(normalized)

	type hitRange struct {
		origStart, origEnd int
	}
	var hits []hitRange

	for _, nw := range normalizedWords {
		wRunes := []rune(nw.normalized)
		if len(wRunes) == 0 {
			continue
		}
		start := 0
		for {
			idx := indexRuneSlice(normRunes[start:], wRunes)
			if idx < 0 {
				break
			}
			nStart := start + idx
			nEnd := nStart + len(wRunes)
			origStart := normToOrig[nStart]
			origEnd := normToOrig[nEnd-1] + 1
			hits = append(hits, hitRange{origStart, origEnd})
			start = nEnd
		}
	}

	if len(hits) == 0 {
		return text, nil
	}

	switch ctx {
	case SanitizeContextDisplayName, SanitizeContextQueueName:
		return "", fmt.Errorf("包含违规内容")
	case SanitizeContextChatMessage:
		// 按 origStart 升序排序，合并真正重叠（非相邻）的区间。
		sort.Slice(hits, func(i, j int) bool {
			return hits[i].origStart < hits[j].origStart
		})
		var merged []hitRange
		for _, h := range hits {
			if len(merged) > 0 && h.origStart < merged[len(merged)-1].origEnd {
				if h.origEnd > merged[len(merged)-1].origEnd {
					merged[len(merged)-1].origEnd = h.origEnd
				}
			} else {
				merged = append(merged, h)
			}
		}
		// 从后往前替换，避免索引偏移。
		result := []rune(text)
		for i := len(merged) - 1; i >= 0; i-- {
			h := merged[i]
			result = replaceRuneSlice(result, h.origStart, h.origEnd, []rune("***"))
		}
		return string(result), nil
	}
	return text, nil
}

// Deprecated: Use SanitizeUserText instead.
// FilterMessage 对输入字符串做大小写不敏感的子串匹配，
// 命中的敏感词替换为 "***"，返回过滤后的字符串。
// 保留导出以兼容 turn.go 等旧调用方与回放确定性，内部转发到 SanitizeUserText 的掩码路径。
func FilterMessage(s string) string {
	masked, _ := SanitizeUserText(s, SanitizeContextChatMessage)
	return masked
}

// indexRuneSlice 在 haystack 中查找 needle 的首次出现位置（rune 索引），
// 未找到返回 -1。等价于 strings.Index 但基于 []rune 索引。
func indexRuneSlice(haystack, needle []rune) int {
	if len(needle) == 0 {
		return 0
	}
	if len(haystack) < len(needle) {
		return -1
	}
	for i := 0; i <= len(haystack)-len(needle); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// replaceRuneSlice 将 s 的 [start, end) 区间替换为 replacement，
// 返回新切片（不修改原切片）。
func replaceRuneSlice(s []rune, start, end int, replacement []rune) []rune {
	if start < 0 {
		start = 0
	}
	if end > len(s) {
		end = len(s)
	}
	if start > end {
		start = end
	}
	result := make([]rune, 0, len(s)-(end-start)+len(replacement))
	result = append(result, s[:start]...)
	result = append(result, replacement...)
	result = append(result, s[end:]...)
	return result
}
