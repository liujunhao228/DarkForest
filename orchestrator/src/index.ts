/**
 * orchestrator 服务入口：读配置 → 建 AgentProcessManager（真实 dsh spawn）→ 起 HTTP server。
 *
 * 由 scripts/up.ps1 以 `npm run dev` 拉起；env 注入见 .env.example。
 *
 * @module
 */

import { loadConfig } from './config.js'
import { createHttpServer } from './http.js'
import { AgentProcessManager } from './manager.js'
import { spawnDshAgent } from './spawn.js'

const config = loadConfig()
const manager = new AgentProcessManager(spawnDshAgent, {
  dshRoot: config.dshRoot,
  profile: config.profile,
  seedSids: config.seedSids,
})

const server = createHttpServer(manager)
server.listen(config.port, () => {
  console.log(`[orchestrator] listening on :${config.port} (profile=${config.profile}, dshRoot=${config.dshRoot}, sidPool=${config.seedSids.length})`)
})
