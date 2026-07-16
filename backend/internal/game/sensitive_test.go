package game

import "testing"

// TestFilterMessage_Empty 验证空串输入返回空串。
func TestFilterMessage_Empty(t *testing.T) {
	if got := FilterMessage(""); got != "" {
		t.Errorf("FilterMessage(\"\") = %q, want \"\"", got)
	}
}

// TestFilterMessage_NoHit 验证无敏感词命中时原样返回。
func TestFilterMessage_NoHit(t *testing.T) {
	in := "这是一段普通的安全留言。"
	if got := FilterMessage(in); got != in {
		t.Errorf("FilterMessage(%q) = %q, want 原样返回", in, got)
	}
}

// TestFilterMessage_SingleHit 验证单个敏感词命中替换为 ***。
func TestFilterMessage_SingleHit(t *testing.T) {
	in := "这里有一个敏感词a需要过滤"
	want := "这里有一个***需要过滤"
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_MultipleHits 验证多个敏感词同时命中均被替换。
func TestFilterMessage_MultipleHits(t *testing.T) {
	in := "敏感词a和敏感词b都应被过滤"
	want := "***和***都应被过滤"
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_SameWordMultipleOccurrences 验证同一敏感词多次出现均被替换。
func TestFilterMessage_SameWordMultipleOccurrences(t *testing.T) {
	in := "敏感词a敏感词a敏感词a"
	want := "*********" // 3 次 *** 拼接
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_CaseInsensitive 验证大小写不敏感匹配。
// 英文样例词 "badword" 应命中 "BadWord"、"BADWORD" 等。
func TestFilterMessage_CaseInsensitive(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"hello BadWord world", "hello *** world"},
		{"BADWORD is here", "*** is here"},
		{"mix badWORD mix", "mix *** mix"},
	}
	for _, tc := range cases {
		if got := FilterMessage(tc.in); got != tc.want {
			t.Errorf("FilterMessage(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestFilterMessage_OverlappingWords 验证重叠词场景：长词优先匹配。
// "违禁品m" 与潜在短词 "违禁品"（虽未列入词表，但此处验证长词完整命中不被截断）。
// 同时验证包含 "违禁品m" 的输入被整体替换。
func TestFilterMessage_OverlappingWords(t *testing.T) {
	in := "发现违禁品m在此"
	want := "发现***在此"
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_MixedCaseWithChinese 验证中英混合大小写不敏感。
// "敏感词a" 中的 'a' 是 ASCII，应与 "敏感词A" 匹配。
func TestFilterMessage_MixedCaseWithChinese(t *testing.T) {
	in := "敏感词A出现在这里"
	want := "***出现在这里"
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_PartialWordNotMatched 验证非完整子串不被误判。
// "badwords"（带 s 后缀）应整体命中 "badword" 后保留 's'。
func TestFilterMessage_PartialWordNotMatched(t *testing.T) {
	in := "badwords here"
	// "badword" 命中后剩 's'，故结果为 "***s here"
	want := "***s here"
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_MultipleDistinctWords 验证多个不同敏感词在同一段文本中均被替换。
func TestFilterMessage_MultipleDistinctWords(t *testing.T) {
	in := "badword 与 cheatcode 同时出现"
	want := "*** 与 *** 同时出现"
	if got := FilterMessage(in); got != want {
		t.Errorf("FilterMessage(%q) = %q, want %q", in, got, want)
	}
}

// TestFilterMessage_DoesNotMutateInput 验证 FilterMessage 是纯函数，
// 不修改调用方传入的字符串变量（Go 字符串不可变，此测试作为契约文档）。
func TestFilterMessage_DoesNotMutateInput(t *testing.T) {
	in := "敏感词a测试"
	original := in
	_ = FilterMessage(in)
	if in != original {
		t.Errorf("input was mutated: %q -> %q", original, in)
	}
}

// ---------------------------------------------------------------------------
// normalizeForMatch 单元测试（Task 2.3）
// ---------------------------------------------------------------------------

// TestNormalizeForMatch_ZeroWidth 验证零宽字符被移除。
func TestNormalizeForMatch_ZeroWidth(t *testing.T) {
	in := "bad\u200bword"
	want := "badword"
	if got := normalizeForMatch(in); got != want {
		t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
	}
}

// TestNormalizeForMatch_FullWidth 验证全角字符经 NFKC 归一化为半角。
func TestNormalizeForMatch_FullWidth(t *testing.T) {
	in := "ｂａｄｗｏｒｄ"
	want := "badword"
	if got := normalizeForMatch(in); got != want {
		t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
	}
}

// TestNormalizeForMatch_WhitespaceInsertion 验证空白插入被移除。
func TestNormalizeForMatch_WhitespaceInsertion(t *testing.T) {
	in := "b a d w o r d"
	want := "badword"
	if got := normalizeForMatch(in); got != want {
		t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
	}
}

// TestNormalizeForMatch_NormalText 验证普通文本仅做匹配用归一化（空白被移除）。
// 注意：归一化结果仅用于匹配比对，不用于展示。
func TestNormalizeForMatch_NormalText(t *testing.T) {
	in := "hello world"
	want := "helloworld"
	if got := normalizeForMatch(in); got != want {
		t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
	}
}

// TestNormalizeForMatch_BenignChinese 验证良性中文文本归一化后不产生误判。
func TestNormalizeForMatch_BenignChinese(t *testing.T) {
	in := "正常玩家"
	want := "正常玩家"
	if got := normalizeForMatch(in); got != want {
		t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
	}
}

// TestNormalizeForMatch_Punctuation 验证 ASCII 标点被移除。
func TestNormalizeForMatch_Punctuation(t *testing.T) {
	in := "b!a@d#w%o^r&d"
	want := "badword"
	if got := normalizeForMatch(in); got != want {
		t.Errorf("normalizeForMatch(%q) = %q, want %q", in, got, want)
	}
}

// ---------------------------------------------------------------------------
// SanitizeUserText 单元测试（Task 3.4）
// ---------------------------------------------------------------------------

// TestSanitizeUserText_DisplayNameReject 验证 DisplayName 上下文命中即拒绝。
func TestSanitizeUserText_DisplayNameReject(t *testing.T) {
	out, err := SanitizeUserText("badword玩家", SanitizeContextDisplayName)
	if err == nil {
		t.Errorf("SanitizeUserText(DisplayName) 期望返回 error, 实际 err=nil out=%q", out)
	}
	if out != "" {
		t.Errorf("SanitizeUserText(DisplayName) 命中应返回空串, 实际 out=%q", out)
	}
}

// TestSanitizeUserText_QueueNameReject 验证 QueueName 上下文命中即拒绝。
func TestSanitizeUserText_QueueNameReject(t *testing.T) {
	out, err := SanitizeUserText("我的敏感词a队列", SanitizeContextQueueName)
	if err == nil {
		t.Errorf("SanitizeUserText(QueueName) 期望返回 error, 实际 err=nil out=%q", out)
	}
	if out != "" {
		t.Errorf("SanitizeUserText(QueueName) 命中应返回空串, 实际 out=%q", out)
	}
}

// TestSanitizeUserText_ChatMask 验证 ChatMessage 上下文命中即掩码，不返回 error。
func TestSanitizeUserText_ChatMask(t *testing.T) {
	in := "hello badword world"
	want := "hello *** world"
	out, err := SanitizeUserText(in, SanitizeContextChatMessage)
	if err != nil {
		t.Errorf("SanitizeUserText(ChatMessage) 不期望返回 error, 实际 err=%v", err)
	}
	if out != want {
		t.Errorf("SanitizeUserText(%q, ChatMessage) = %q, want %q", in, out, want)
	}
}

// TestSanitizeUserText_NoHit 验证无命中返回原文。
func TestSanitizeUserText_NoHit(t *testing.T) {
	in := "这是一段普通的安全留言。"
	out, err := SanitizeUserText(in, SanitizeContextChatMessage)
	if err != nil {
		t.Errorf("SanitizeUserText 无命中不应返回 error, 实际 err=%v", err)
	}
	if out != in {
		t.Errorf("SanitizeUserText(%q) = %q, want 原样返回", in, out)
	}
}

// TestSanitizeUserText_ZeroWidthBypassBlocked 验证零宽字符绕过被拦截。
func TestSanitizeUserText_ZeroWidthBypassBlocked(t *testing.T) {
	in := "bad\u200bword"
	want := "***"
	out, err := SanitizeUserText(in, SanitizeContextChatMessage)
	if err != nil {
		t.Errorf("SanitizeUserText(ChatMessage) 不期望返回 error, 实际 err=%v", err)
	}
	if out != want {
		t.Errorf("SanitizeUserText(%q, ChatMessage) = %q, want %q", in, out, want)
	}
}

// TestSanitizeUserText_FullWidthBypassBlocked 验证全角字符绕过被拦截。
func TestSanitizeUserText_FullWidthBypassBlocked(t *testing.T) {
	in := "ｂａｄｗｏｒｄ"
	want := "***"
	out, err := SanitizeUserText(in, SanitizeContextChatMessage)
	if err != nil {
		t.Errorf("SanitizeUserText(ChatMessage) 不期望返回 error, 实际 err=%v", err)
	}
	if out != want {
		t.Errorf("SanitizeUserText(%q, ChatMessage) = %q, want %q", in, out, want)
	}
}

// TestSanitizeUserText_WhitespaceBypassBlocked 验证空白插入绕过被拦截。
func TestSanitizeUserText_WhitespaceBypassBlocked(t *testing.T) {
	in := "b a d w o r d"
	want := "***"
	out, err := SanitizeUserText(in, SanitizeContextChatMessage)
	if err != nil {
		t.Errorf("SanitizeUserText(ChatMessage) 不期望返回 error, 实际 err=%v", err)
	}
	if out != want {
		t.Errorf("SanitizeUserText(%q, ChatMessage) = %q, want %q", in, out, want)
	}
}

// TestSanitizeUserText_EmptyInput 验证空输入直接返回。
func TestSanitizeUserText_EmptyInput(t *testing.T) {
	out, err := SanitizeUserText("", SanitizeContextChatMessage)
	if err != nil {
		t.Errorf("SanitizeUserText(\"\") 不应返回 error, 实际 err=%v", err)
	}
	if out != "" {
		t.Errorf("SanitizeUserText(\"\") = %q, want \"\"", out)
	}
}

// TestSanitizeUserText_BenignNoFalsePositive 验证良性文本不产生误判。
func TestSanitizeUserText_BenignNoFalsePositive(t *testing.T) {
	cases := []string{
		"正常玩家",
		"hello",
		"普通队列名",
	}
	for _, in := range cases {
		out, err := SanitizeUserText(in, SanitizeContextDisplayName)
		if err != nil {
			t.Errorf("SanitizeUserText(%q, DisplayName) 良性文本不应返回 error, 实际 err=%v", in, err)
		}
		if out != in {
			t.Errorf("SanitizeUserText(%q, DisplayName) = %q, want 原样返回", in, out)
		}
	}
}

// ---------------------------------------------------------------------------
// GetSensitiveWords 单元测试（Task 1.3）
// ---------------------------------------------------------------------------

// TestGetSensitiveWords 验证返回原始词表副本，修改返回切片不影响内部状态。
func TestGetSensitiveWords(t *testing.T) {
	words := GetSensitiveWords()
	if len(words) == 0 {
		t.Fatal("GetSensitiveWords() 返回空切片, 期望非空词表")
	}
	// 确认包含已知占位词
	found := false
	for _, w := range words {
		if w == "badword" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("GetSensitiveWords() 未包含期望词 \"badword\", 实际 %v", words)
	}
	// 修改返回切片，验证内部状态不受影响
	original := words[0]
	words[0] = "__mutated__"
	again := GetSensitiveWords()
	if again[0] != original {
		t.Errorf("修改 GetSensitiveWords() 返回切片影响了内部状态: 期望 %q, 实际 %q", original, again[0])
	}
}
