import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// 测试环境不输出查询日志，避免测试输出被大量日志淹没
const isTest = process.env.NODE_ENV === 'test' || process.argv.some(arg => arg.includes('test'));

// 从环境变量读取 Prisma 日志级别，默认为 'error'（抑制 query 日志）
const prismaLogLevel = process.env.PRISMA_LOG_LEVEL || 'error';
const logConfig: Array<'query' | 'info' | 'warn' | 'error'> = isTest ? [] : (prismaLogLevel === 'error' ? [] : ['query']);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logConfig,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db