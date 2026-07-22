package game

// AddStarEffect 向星系添加持续效果。同类型效果覆盖（刷新 AppliedAtTurn 和 Duration）。
func AddStarEffect(state *GameState, systemID int, effectType StarEffectType, duration int, sourceStrikeUID string) {
	// 移除同星系同类型的旧效果
	filtered := state.StarEffects[:0]
	for _, e := range state.StarEffects {
		if !(e.SystemID == systemID && e.Type == effectType) {
			filtered = append(filtered, e)
		}
	}
	state.StarEffects = append(filtered, StarEffect{
		SystemID:        systemID,
		Type:            effectType,
		AppliedAtTurn:   state.TotalTurn,
		Duration:        duration,
		SourceStrikeUID: sourceStrikeUID,
	})
}

// IsStarEffectActive 检查星系上是否有指定类型的活跃效果。
func IsStarEffectActive(state *GameState, systemID int, effectType StarEffectType) bool {
	for _, e := range state.StarEffects {
		if e.SystemID == systemID && e.Type == effectType {
			if e.Duration < 0 {
				return true // 永久
			}
			return state.TotalTurn-e.AppliedAtTurn < e.Duration
		}
	}
	return false
}

// PurgeExpiredStarEffects 清理已过期的星系效果（避免列表膨胀）。
// 在 processTurnBegin 中调用。
func PurgeExpiredStarEffects(state *GameState) {
	var active []StarEffect
	for _, e := range state.StarEffects {
		if e.Duration < 0 {
			active = append(active, e)
		} else if state.TotalTurn-e.AppliedAtTurn < e.Duration {
			active = append(active, e)
		}
	}
	state.StarEffects = active
}
