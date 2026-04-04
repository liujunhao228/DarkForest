---
Task ID: 2
Agent: main
Task: 修复 WebSocket 服务器 Player 外键约束问题 & 数据库 Schema 重构

问题描述:
- WebSocket 登录时创建 Player 失败，外键约束违规 (P2003)
- 原因: Player.userId 外键关联 User.id，但客户端使用随机 userId 登录
- User 表在 User 不存在时无法创建 Player

解决方案:
- 移除 Player 对 User 的外键依赖，Player 改为独立表
- userId 字段保留为独立字符串（客户端随机生成）
- 更新所有相关查询移除 user 关联

修改文件:
- prisma/schema.prisma: 移除 Player.user 关系，保留 User 模型为预留
- src/lib/matchmaking.ts: 移除 3 处 include: { user: true }
- src/lib/__tests__/matchmaking.test.ts: 测试不再创建 User
- src/server/__tests__/gameServer.test.ts: createTestUser → createTestPlayer

状态: ✅ 完成 - WebSocket 登录正常工作

待办:
- [ ] 未来实现正式账号系统时，重新建立 Player → User 关联
- [ ] 实现用户认证 (next-auth 预留)
- [ ] 实现邮箱/密码注册系统
