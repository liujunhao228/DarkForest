"""darkforest-autonomous: 确定性对局驾驶器（纯 MCP client）。

驾驶器以显式状态机驱动完整对局流程（账号 → 排队 → 进房 → 对局 → 结算 → 回放），
决策大脑经 Decide 协议可插拔（默认规则策略占位，后续接入 prime-agent）。
"""

__version__ = "0.1.0"
