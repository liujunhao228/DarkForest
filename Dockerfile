# ============================================================
# 黑暗森林 (Dark Forest) - 生产 Dockerfile (优化版)
# 改进：多阶段构建、依赖优化、镜像大小减少、构建效率提升
# ============================================================

# 使用 BuildKit 加速构建
# syntax=docker/dockerfile:1.4

ARG BUN_VERSION=1

# -------------------- 阶段 1: 依赖安装 (仅生产依赖) --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

# 复制依赖文件
COPY package.json bun.lockb* ./

# 安装仅生产依赖，减少镜像大小
RUN bun install --frozen-lockfile --production

# -------------------- 阶段 2: 构建依赖安装 (含 devDependencies) --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build-deps
WORKDIR /app

# 复制依赖文件
COPY package.json bun.lockb* ./

# 安装所有依赖（含 devDependencies），构建阶段需要 TypeScript/Tailwind
RUN bun install --frozen-lockfile

# -------------------- 阶段 3: 构建应用 --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

# 复制构建依赖
COPY --from=build-deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma/ ./prisma/

# 生成 Prisma Client (构建时需要)
RUN bunx prisma generate

# 复制源码
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY public/ ./public/
COPY src/ ./src/
COPY server.js ./

# 设置构建环境变量
ENV NODE_ENV=production

# 构建应用
RUN bun run build

# -------------------- 阶段 4: 生产运行 --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS production

WORKDIR /app

# 安装运行时必需的系统库 (Prisma 需要 openssl)
# 移除不必要的包，减少镜像大小
RUN apk add --no-cache tini openssl && \
    apk del --purge *-doc *-dev && \
    rm -rf /var/cache/apk/*

# 创建用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -S -u 1001 -G appgroup appuser

# 1. 复制仅生产依赖，减少镜像大小
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules

# 2. 复制构建产物
COPY --from=build --chown=appuser:appgroup /app/.next ./.next
COPY --from=build --chown=appuser:appgroup /app/public ./public

# 3. 复制运行时需要的文件
COPY --from=build --chown=appuser:appgroup /app/package.json ./package.json
COPY --from=build --chown=appuser:appgroup /app/server.js ./server.js
COPY --from=build --chown=appuser:appgroup /app/next.config.ts ./next.config.ts

# 4. 复制 WebSocket 服务器需要的源码（仅必要文件）
COPY --from=build --chown=appuser:appgroup /app/src/server ./src/server
COPY --from=build --chown=appuser:appgroup /app/src/lib ./src/lib
COPY --from=build --chown=appuser:appgroup /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=appuser:appgroup /app/prisma ./prisma

# 生成 Prisma Client (针对生产环境二进制)
RUN bunx prisma generate

# 创建数据库目录
RUN mkdir -p /app/db && chown -R appuser:appgroup /app/db

# 复制启动脚本（从构建上下文直接复制）
# 注意：Windows 上使用 CRLF 换行符，需要转换为 LF
COPY docker-entrypoint.sh /tmp/docker-entrypoint.sh
COPY start-all.sh /tmp/start-all.sh
RUN sed -i 's/\r$//' /tmp/docker-entrypoint.sh && \
    sed -i 's/\r$//' /tmp/start-all.sh && \
    mv /tmp/docker-entrypoint.sh /app/docker-entrypoint.sh && \
    mv /tmp/start-all.sh /app/start-all.sh && \
    chmod +x /app/docker-entrypoint.sh && \
    chmod +x /app/start-all.sh && \
    chown appuser:appgroup /app/docker-entrypoint.sh /app/start-all.sh

# 环境变量
ENV NODE_ENV=production \
    PORT=3000 \
    BUN_ENV=production \
    PRISMA_CLI_BINARY_TARGETS=linux-musl \
    # 优化 Node.js 性能
    NODE_OPTIONS="--max-old-space-size=512 --optimize-for-size"

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# 设置数据库 URL 环境变量
ENV DATABASE_URL=file:/app/db/custom.db

# 清理临时文件
RUN rm -rf /tmp/*

USER appuser

# 暴露端口
EXPOSE 3000 3003

ENTRYPOINT ["tini", "--", "./docker-entrypoint.sh"]
CMD ["./start-all.sh"]
