/**
 * DarkForest GameAgent 入口。
 *
 * 启动流程：加载配置 → 创建 GameAgentManager → 启动 HTTP API 服务器。
 */

import process from "node:process";
import { loadConfig } from "./config.js";
import { GameAgentManager } from "./manager.js";
import { createHttpApiServer } from "./http-api.js";

export const VERSION = "0.1.0";

/** 主入口 */
export async function main(): Promise<void> {
  console.log(`darkforest-gameagent ${VERSION} 启动中…`);

  const config = loadConfig();

  // 创建 Agent 管理器
  console.log("[manager] 正在创建 Agent 管理器 session…");
  const manager = await GameAgentManager.create(config);
  console.log("[manager] Agent 管理器 session 已就绪");

  // 启动 HTTP API 服务器
  const server = createHttpApiServer(manager, config.managerPort);
  await server.start();

  // 优雅退出
  const shutdown = async (signal: string) => {
    console.log(`\n[manager] 收到 ${signal}，正在关闭…`);
    await server.close();
    await manager.dispose();
    console.log("[manager] 已关闭");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// 直接运行入口（非 import 场景）
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  main().catch((err) => {
    console.error("启动失败:", err);
    process.exit(1);
  });
}