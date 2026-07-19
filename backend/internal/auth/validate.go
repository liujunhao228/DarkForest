package auth

import (
	"fmt"
	"unicode"
)

// ValidatePasswordStrength 校验密码强度
// 规则:长度 ≥ 8,至少包含一个字母和一个数字,不包含空白字符
func ValidatePasswordStrength(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("密码长度至少为 8 位")
	}

	hasLetter := false
	hasDigit := false
	for _, r := range password {
		if unicode.IsSpace(r) {
			return fmt.Errorf("密码不能包含空白字符")
		}
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}

	if !hasLetter {
		return fmt.Errorf("密码必须包含至少一个字母")
	}
	if !hasDigit {
		return fmt.Errorf("密码必须包含至少一个数字")
	}

	return nil
}
