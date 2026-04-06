# ============================================================
# 黑暗森林 (Dark Forest) - 生产 Dockerfile (优化版)
# 改进：依赖分类、Standalone 兼容、WebSocket 支持、安全迁移
# ============================================================

ARG BUN_VERSION=1

# -------------------- 阶段 1: 依赖安装 --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS deps
WORKDIR /app

COPY package.json bun.lockb* ./

# 安装所有依赖（含 devDependencies），构建阶段需要 TypeScript/Tailwind
RUN bun install --frozen-lockfile

# -------------------- 阶段 2: 构建应用 --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma/ ./prisma/

# 生成 Prisma Client (构建时需要)
RUN bunx prisma generate

# 复制源码
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY public/ ./public/
COPY src/ ./src/
COPY server.js ./

ENV NODE_ENV=production
RUN bun run build

# -------------------- 阶段 3: 生产运行 --------------------
FROM oven/bun:${BUN_VERSION}-alpine AS production

WORKDIR /app

# 安装运行时必需的系统库 (Prisma 需要 openssl)
RUN apk add --no-cache tini openssl

# 创建用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -S -u 1001 -G appgroup appuser

# 1. 复制 Next.js Standalone 产物 (自带精简 node_modules)
COPY --from=build --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=build --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=build --chown=appuser:appgroup /app/public ./public

# 2. 安装生产依赖（解决 Standalone 模式无法检测 WebSocket 依赖的问题）
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --ignore-scripts && \
    rm -rf /root/.bun/install/cache && \
    chown -R appuser:appgroup /app/node_modules

# 复制 Prisma Schema 和迁移文件
COPY --from=build --chown=appuser:appgroup /app/prisma ./prisma

# 复制 WebSocket 源码和配置
COPY --from=build --chown=appuser:appgroup /app/src ./src
COPY --from=build --chown=appuser:appgroup /app/tsconfig.json ./tsconfig.json

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
    chown appuser:appgroup /app/docker-entrypoint.sh /app/start-all.sh && \
    ls -la /app/*.sh

# 环境变量
ENV NODE_ENV=production \
    PORT=3000 \
    BUN_ENV=production \
    PRISMA_CLI_BINARY_TARGETS=linux-musl

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# 设置数据库 URL 环境变量
ENV DATABASE_URL=file:/app/db/custom.db

USER appuser

ENTRYPOINT ["tini", "--", "./docker-entrypoint.sh"]
CMD ["./start-all.sh"]
