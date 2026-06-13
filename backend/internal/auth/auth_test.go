package auth

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func setupTestEnv(t *testing.T) {
	t.Helper()
	os.Setenv("JWT_SECRET", "test-secret-key-for-unit-tests-only")
	os.Setenv("ADMIN_SECRET_KEY", "test-admin-secret")
	initialized = false
}

func TestHashAndVerifyPassword(t *testing.T) {
	setupTestEnv(t)

	password := "mySecurePassword123"

	hashed, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}

	if hashed == password {
		t.Error("Hashed password should not equal plain password")
	}

	if !VerifyPassword(password, hashed) {
		t.Error("VerifyPassword should return true for correct password")
	}

	if VerifyPassword("wrongPassword", hashed) {
		t.Error("VerifyPassword should return false for wrong password")
	}
}

func TestGenerateAndVerifyToken(t *testing.T) {
	setupTestEnv(t)

	payload := JWTPayload{
		PlayerID:    "player-123",
		UserID:      "user-456",
		Role:        "player",
		DisplayName: "TestPlayer",
	}

	token, err := GenerateToken(payload)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	if token == "" {
		t.Fatal("Generated token should not be empty")
	}

	decoded, err := VerifyToken(token)
	if err != nil {
		t.Fatalf("VerifyToken failed: %v", err)
	}

	if decoded.PlayerID != payload.PlayerID {
		t.Errorf("PlayerID mismatch: got %s, want %s", decoded.PlayerID, payload.PlayerID)
	}

	if decoded.UserID != payload.UserID {
		t.Errorf("UserID mismatch: got %s, want %s", decoded.UserID, payload.UserID)
	}

	if decoded.Role != payload.Role {
		t.Errorf("Role mismatch: got %s, want %s", decoded.Role, payload.Role)
	}

	if decoded.DisplayName != payload.DisplayName {
		t.Errorf("DisplayName mismatch: got %s, want %s", decoded.DisplayName, payload.DisplayName)
	}
}

func TestVerifyTokenWithInvalidToken(t *testing.T) {
	setupTestEnv(t)

	_, err := VerifyToken("invalid.token.here")
	if err == nil {
		t.Error("VerifyToken should fail for invalid token")
	}
}

func TestVerifyAdminSecret(t *testing.T) {
	setupTestEnv(t)

	if !VerifyAdminSecret("test-admin-secret") {
		t.Error("VerifyAdminSecret should return true for correct secret")
	}

	if VerifyAdminSecret("wrong-secret") {
		t.Error("VerifyAdminSecret should return false for wrong secret")
	}
}

func TestGenerateInviteCode(t *testing.T) {
	setupTestEnv(t)

	code := GenerateInviteCode()
	if len(code) != 6 {
		t.Errorf("Invite code should be 6 characters, got %d", len(code))
	}

	validChars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for _, c := range code {
		if !strings.ContainsRune(validChars, c) {
			t.Errorf("Invalid character in invite code: %c", c)
		}
	}

	code2 := GenerateInviteCode()
	if code == code2 {
		t.Error("Two generated codes should not be equal (extremely unlikely)")
	}
}

func TestExtractTokenFromHeader(t *testing.T) {
	setupTestEnv(t)

	validHeader := "Bearer my.token.here"
	token, err := ExtractTokenFromHeader(validHeader)
	if err != nil {
		t.Errorf("ExtractTokenFromHeader should succeed for Bearer token, got error: %v", err)
	}
	if token != "my.token.here" {
		t.Errorf("Expected 'my.token.here', got '%s'", token)
	}

	_, err = ExtractTokenFromHeader("Basic abc123")
	if err == nil {
		t.Error("ExtractTokenFromHeader should fail for non-Bearer token")
	}

	_, err = ExtractTokenFromHeader("")
	if err == nil {
		t.Error("ExtractTokenFromHeader should fail for empty string")
	}
}

func TestTokenExpiration(t *testing.T) {
	setupTestEnv(t)

	// Generate a token that we'll test expires
	originalExpiresIn := TokenExpiresIn
	defer func() {
		// Can't easily restore, but we don't need to for this test
		_ = originalExpiresIn
	}()

	payload := JWTPayload{
		PlayerID:    "player-expired",
		UserID:      "user-expired",
		Role:        "player",
		DisplayName: "ExpiredTest",
	}

	// Manually create an expired token
	claims := jwtClaims{
		JWTPayload: payload,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	expiredToken, _ := token.SignedString(jwtSecret)

	_, err := VerifyToken(expiredToken)
	if err == nil {
		t.Error("Expired token should fail verification")
	}
}
