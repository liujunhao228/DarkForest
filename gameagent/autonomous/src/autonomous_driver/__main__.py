"""python -m autonomous_driver 入口：转发到 cli 的 typer app。

使 ``python -m autonomous_driver [--script ...] [--games N]`` 可直接运行
（否则 ``-m`` 要求包存在 ``__main__`` 模块）。

缺省子命令路由：显式给出子命令（run / validate）按原样执行；未给出
（argv[1] 是选项或不存在）时经 cli._route_argv 自动插入 ``run``——保持旧
用法 ``python -m autonomous_driver --script <path> --games N`` 不变。
"""

import sys

from autonomous_driver.cli import _route_argv, app

if __name__ == "__main__":
    sys.argv = _route_argv(sys.argv)
    app()
