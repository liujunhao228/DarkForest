package api

import (
	"encoding/json"
	"net/http"

	"github.com/darkforest/backend/internal/game"
)

// SensitiveWordsHandler 返回当前生效的敏感词列表（用于前端预览过滤）。
// 词表为占位测试词，无敏感政治内容，故不做鉴权。
// 返回的切片是内部词表的副本，调用方修改不会影响内部状态。
func SensitiveWordsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	words := game.GetSensitiveWords()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(words); err != nil {
		// 响应已开始写入，仅记录日志即可
		http.Error(w, "编码失败", http.StatusInternalServerError)
	}
}
