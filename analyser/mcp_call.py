"""通用 mcpserver MCP 工具调用器（Streamable HTTP）。

用法: python mcp_call.py <tool_name> '<json_args>' [mcp_url]

通用 JSON 模式（注意: cmd 不支持单引号字符串, 引号转义很痛苦,
推荐用下面的便捷模式）:
  python mcp_call.py list_pool_accounts '{}'
  python mcp_call.py fetch_shared_replay '{"replayId":"<uuid>|/replay/<id>|完整URL"}'

add_pool_account 便捷模式（位置参数, cmd/PowerShell 通用, 免 JSON 转义）:
  python mcp_call.py add_pool_account <displayName> <password>
  python mcp_call.py add_pool_account 草狐也是犬科 我的密码

依赖: 使用 analyser 虚拟环境（已装 mcp>=1.0）:
  E:\\DarkForest\\analyser\\.venv\\Scripts\\python.exe mcp_call.py ...
"""
import asyncio
import json
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    tool = sys.argv[1]
    # add_pool_account 便捷模式: 第3、4个位置参数直接作为 displayName/password。
    # 判定条件: 工具名匹配且第2参数不是 JSON 对象（不以 { 开头）。
    if (
        tool == "add_pool_account"
        and len(sys.argv) >= 4
        and not sys.argv[2].lstrip().startswith("{")
    ):
        args: dict[str, object] = {
            "displayName": sys.argv[2],
            "password": sys.argv[3],
        }
    else:
        args = json.loads(sys.argv[2])
    url = sys.argv[3] if len(sys.argv) > 3 else "http://localhost:9090/mcp"
    async with streamable_http_client(url) as (read, write, _get_session_id):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool, args)
            print("isError:", result.isError)
            for item in result.content:
                text = getattr(item, "text", None)
                if text:
                    print(text)
            if result.isError:
                sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
