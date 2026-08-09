# syntax=docker/dockerfile:1.7
# mcpserver 独立镜像（LOCAL_TRUST_MODE 本地方案用，见 docker-compose.trust.yml）
FROM golang:1.26.4-alpine AS build
WORKDIR /app
ENV GOPROXY=direct GOCACHE=/root/.cache/go-build GOFLAGS=-trimpath
RUN apk add --no-cache git ca-certificates tzdata
COPY --link go.mod go.sum ./
RUN --mount=type=cache,id=mcpserver-go-mod,target=/go/pkg/mod go mod download
COPY --link ./ ./
RUN --mount=type=cache,id=mcpserver-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=mcpserver-go-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o /app/mcpserver ./cmd/mcpserver

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata && \
    addgroup -S mcgroup && adduser -S -G mcgroup mcuser && \
    mkdir -p /app /data && chown -R mcuser:mcgroup /app /data
COPY --link --chown=mcuser:mcgroup --from=build /app/mcpserver /app/mcpserver
USER mcuser
EXPOSE 9090
ENTRYPOINT ["/app/mcpserver"]
