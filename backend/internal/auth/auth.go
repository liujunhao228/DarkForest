package auth

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	SaltRounds     = 10
	TokenExpiresIn = 24 * time.Hour
)

var (
	jwtSecret     []byte
	adminSecret   string
	initialized   bool
)

type JWTPayload struct {
	PlayerID    string `json:"playerId"`
	UserID      string `json:"userId"`
	Role        string `json:"role"`
	DisplayName string `json:"displayName"`
}

type jwtClaims struct {
	JWTPayload
	jwt.RegisteredClaims
}

func Init() error {
	if initialized {
		return nil
	}

	jwtSecretStr := os.Getenv("JWT_SECRET")
	if jwtSecretStr == "" {
		return errors.New("JWT_SECRET environment variable is required")
	}

	adminSecret = os.Getenv("ADMIN_SECRET_KEY")
	if adminSecret == "" {
		return errors.New("ADMIN_SECRET_KEY environment variable is required")
	}

	jwtSecret = []byte(jwtSecretStr)
	initialized = true
	return nil
}

func MustInit() {
	if err := Init(); err != nil {
		panic(fmt.Sprintf("auth initialization failed: %v", err))
	}
}

func GenerateToken(payload JWTPayload) (string, error) {
	if !initialized {
		if err := Init(); err != nil {
			return "", err
		}
	}

	claims := jwtClaims{
		JWTPayload: payload,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(TokenExpiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func VerifyToken(tokenString string) (*JWTPayload, error) {
	if !initialized {
		if err := Init(); err != nil {
			return nil, err
		}
	}

	claims := &jwtClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	return &claims.JWTPayload, nil
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), SaltRounds)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(bytes), nil
}

func VerifyPassword(password, hashedPassword string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	return err == nil
}

func VerifyAdminSecret(secret string) bool {
	if !initialized {
		if err := Init(); err != nil {
			return false
		}
	}
	return secret == adminSecret
}

func GenerateInviteCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "ABCDEF"
	}
	var code strings.Builder
	for _, b := range bytes {
		code.WriteByte(chars[int(b)%len(chars)])
	}
	return code.String()
}

func ExtractTokenFromHeader(authHeader string) (string, error) {
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", errors.New("invalid authorization header format")
	}
	return strings.TrimPrefix(authHeader, "Bearer "), nil
}
