# ============================================================
# 黑暗森林 (Dark Forest) - 多阶段 Dockerfile
# 运行时: Bun
# 框架: Next.js 16 (standalone 输出)
# ============================================================

# -------------------- 阶段 1: 依赖安装 --------------------
FROM oven/bun:1-alpine AS deps

WORKDIR /app

# 安装 OpenSSL (bcrypt 依赖) 和其他原生依赖
RUN apk add --no-cache openssl

# 复制包管理文件
COPY package.json bun.lock ./

# 安装所有依赖
RUN bun install --frozen-lockfile

# -------------------- 阶段 2: 开发环境 --------------------
FROM oven/bun:1-alpine AS dev

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache openssl

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制项目文件
COPY . .

# 暴露端口
EXPOSE 3000
EXPOSE 3003

# 开发模式启动
CMD ["bun", "run", "dev"]

# -------------------- 阶段 3: 构建阶段 --------------------
FROM oven/bun:1-alpine AS build

WORKDIR /app

# 安装构建依赖
RUN apk add --no-cache openssl

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制项目文件
COPY . .

# 生成 Prisma 客户端
RUN bun run db:generate

# 构建 Next.js 独立输出
RUN bun run build

# -------------------- 阶段 4: 生产环境 --------------------
FROM oven/bun:1-alpine AS production

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache openssl

# 创建非 root 用户
RUN addgroup -g 1001 -S darkforest && \
    adduser -S darkforest -u 1001 -G darkforest

# 复制 standalone 输出
COPY --from=build --chown=darkforest:darkforest /app/.next/standalone ./
COPY --from=build --chown=darkforest:darkforest /app/.next/static ./.next/static
COPY --from=build --chown=darkforest:darkforest /app/public ./public
COPY --from=build --chown=darkforest:darkforest /app/prisma ./prisma
COPY --from=build --chown=darkforest:darkforest /app/node_modules/.prisma ./node_modules/.prisma

# 创建数据库目录
RUN mkdir -p db && chown -R darkforest:darkforest db

# 切换用户
USER darkforest

# 环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露端口
EXPOSE 3000
EXPOSE 3003

# 健康检查 - 使用轻量级端点
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# 启动命令
CMD ["bun", "run", "start"]
