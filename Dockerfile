# ============================================================
# 黑暗森林 (Dark Forest) - 生产 Dockerfile
# 优化：Alpine 统一镜像、缓存层分离、最小化体积、快速构建
# ============================================================

# 构建参数（可自定义镜像源）
ARG BUN_VERSION=1
ARG ALPINE_MIRROR=""

# -------------------- 阶段 1: 依赖安装 --------------------
FROM oven/bun:1-alpine AS deps
WORKDIR /app

# 优先复制锁文件（利用 Docker 缓存，依赖不变则跳过安装）
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

# -------------------- 阶段 2: 构建应用 --------------------
FROM oven/bun:1-alpine AS build
WORKDIR /app

# 复用依赖层（依赖不变则跳过）
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# 生成 Prisma 客户端（独立层，代码变更不触发重新生成）
COPY prisma/ ./prisma/
RUN bunx prisma generate

# 精细复制源码（按变更频率排序，优化缓存命中）
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY public/ ./public/
COPY src/ ./src/

ENV NODE_ENV=production
RUN bun run build

# -------------------- 阶段 3: 生产运行（最小化）--------------------
FROM oven/bun:1-alpine AS production

WORKDIR /app

# 安装 tini（信号处理）- Alpine 使用 apk 安装，速度更快
RUN apk add --no-cache tini

# 创建非 root 用户 - Alpine 使用 addgroup/adduser
RUN addgroup -g 1001 -S appgroup && \
    adduser -S -u 1001 -G appgroup appuser

# 创建数据库目录
RUN mkdir -p /app/db && chown -R appuser:appgroup /app/db

# 复制构建产物
COPY --from=build --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=build --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=build --chown=appuser:appgroup /app/public ./public
COPY --from=build --chown=appuser:appgroup /app/prisma ./prisma

# 复制完整 node_modules（standalone 模式需要）
COPY --from=deps --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma

# 安全加固：设置生产环境
ENV NODE_ENV=production \
    PORT=3000 \
    BUN_ENV=production

# 健康检查（使用 wget - Alpine 内置）
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# 设置数据库 URL 环境变量（可通过 docker run -e 覆盖）
ENV DATABASE_URL=file:/app/db/custom.db

USER appuser

# 使用 tini 作为 init 系统，在 standalone 目录下启动 Next.js
WORKDIR /app
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
