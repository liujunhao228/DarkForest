package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/darkforest/backend/internal/config"
	"github.com/google/uuid"
)

// contextKey is a type for context keys
type contextKey string

const (
	// RequestIDKey is the context key for request ID
	RequestIDKey contextKey = "requestID"
)

// Middleware is a function that wraps an http.Handler
type Middleware func(http.Handler) http.Handler

// Chain applies multiple middleware in order
func Chain(h http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}

// ErrorResponse represents a JSON error response
type ErrorResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

// WriteJSONError writes a JSON error response
func WriteJSONError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		Success: false,
		Error:   message,
	})
}

// RequestIDMiddleware generates a unique request ID for each request
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = uuid.New().String()
		}

		// Add to response headers
		w.Header().Set("X-Request-ID", requestID)

		// Add to context
		ctx := context.WithValue(r.Context(), RequestIDKey, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// CORSMiddleware handles Cross-Origin Resource Sharing
func CORSMiddleware(cfg *config.Config) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			// Check if origin is allowed
			allowed := false
			for _, allowedOrigin := range cfg.AllowedOrigins {
				if allowedOrigin == "*" || allowedOrigin == origin {
					allowed = true
					break
				}
			}

			if allowed {
				if cfg.IsDevelopment() {
					w.Header().Set("Access-Control-Allow-Origin", "*")
				} else {
					w.Header().Set("Access-Control-Allow-Origin", origin)
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
				w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours
			}

			// Handle preflight request
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// LoggingMiddleware logs request details
func LoggingMiddleware(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Create a response wrapper to capture status code
			rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			// Get request ID from context
			requestID, _ := r.Context().Value(RequestIDKey).(string)

			logger.Info("request started",
				"method", r.Method,
				"path", r.URL.Path,
				"request_id", requestID,
				"remote_addr", r.RemoteAddr,
			)

			next.ServeHTTP(rw, r)

			duration := time.Since(start)

			logger.Info("request completed",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rw.statusCode,
				"duration", duration.String(),
				"request_id", requestID,
			)
		})
	}
}

// RecoveryMiddleware recovers from panics and returns a 500 error
func RecoveryMiddleware(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					requestID, _ := r.Context().Value(RequestIDKey).(string)

					logger.Error("panic recovered",
						"error", fmt.Sprintf("%v", err),
						"method", r.Method,
						"path", r.URL.Path,
						"request_id", requestID,
					)

					// Return a generic error response
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"error":      "Internal server error",
						"request_id": requestID,
					})
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}

// contentSecurityPolicy is the CSP header value for the SPA frontend.
// - script-src 'self' 'unsafe-inline': Vite module preload polyfill injects inline script in index.html.
// - style-src 'unsafe-inline' + fonts.googleapis.com: framer-motion/Radix UI inline styles + Google Fonts CSS.
// - font-src data: + fonts.gstatic.com: Google Fonts font files.
// - connect-src 'self': same-origin API and WebSocket (wss under same host).
// - frame-ancestors 'none': replaces X-Frame-Options DENY for modern browsers.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self' 'unsafe-inline'; " +
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
	"img-src 'self' data: blob:; " +
	"font-src 'self' data: https://fonts.gstatic.com; " +
	"connect-src 'self'; " +
	"frame-ancestors 'none'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'; " +
	"upgrade-insecure-requests"

// SecurityHeadersMiddleware sets standard security-related HTTP headers
func SecurityHeadersMiddleware(cfg *config.Config) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
			w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			w.Header().Set("Content-Security-Policy", contentSecurityPolicy)

			// HSTS: set when the request arrived over HTTPS (direct TLS or
			// via reverse proxy with X-Forwarded-Proto: https).  Also set when
			// IsProduction() as a fallback for bare-metal deployments without
			// the header.  Dev mode (localhost HTTP) never sets HSTS.
			if r.Header.Get("X-Forwarded-Proto") == "https" || cfg.IsProduction() {
				w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
			}

			next.ServeHTTP(w, r)
		})
	}
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return rw.ResponseWriter.(http.Hijacker).Hijack()
}
