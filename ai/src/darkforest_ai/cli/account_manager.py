"""
AI 账号管理器
==============
管理 AI 账号的注册、登录和 token 存储。
每个 AI 玩家使用独立的认证账号，确保 REST API 调用带有有效的 JWT token。

用法：
  from darkforest_ai.cli.account_manager import AccountManager, Account

  manager = AccountManager(config_path="config/accounts.json")
  manager.ensure_accounts(count=4, invite_code="ABC123")
  account = manager.get_account(0)
"""

import json
import logging
import os
import secrets
import string
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger("account-manager")


@dataclass
class Account:
    """AI 账号信息"""
    displayName: str
    password: str
    token: str
    playerId: str


class AccountManager:
    """AI 账号管理器"""

    def __init__(self, config_path: str = "config/accounts.json", server_url: str = "http://localhost:3003"):
        self.config_path = Path(config_path)
        self.server_url = server_url
        self.accounts: list[Account] = []
        self._load_accounts()

    def _load_accounts(self):
        """从配置文件加载账号信息"""
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.accounts = [Account(**acc) for acc in data.get("accounts", [])]
                logger.info(f"✅ 已加载 {len(self.accounts)} 个账号: {self.config_path}")
            except Exception as e:
                logger.warning(f"⚠️ 加载账号配置失败: {e}")
                self.accounts = []
        else:
            logger.info(f"📝 账号配置文件不存在，将自动创建: {self.config_path}")

    def _save_accounts(self):
        """保存账号信息到配置文件"""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "accounts": [asdict(acc) for acc in self.accounts],
            "lastInviteCode": getattr(self, "_last_invite_code", ""),
        }
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info(f"💾 已保存 {len(self.accounts)} 个账号到: {self.config_path}")

    def ensure_accounts(self, count: int, invite_codes: list[str]) -> list[Account]:
        """确保有足够数量的已认证账号
        
        Args:
            count: 需要的账号数量
            invite_codes: 邀请码列表（每个账号一个邀请码）
        
        Returns:
            账号列表
        """
        if len(invite_codes) < count - len(self.accounts):
            raise RuntimeError(
                f"邀请码数量不足：需要 {count - len(self.accounts)} 个，但只提供了 {len(invite_codes)} 个。"
                f"每个账号需要一个独立的邀请码。"
            )
        
        self._last_invite_codes = invite_codes
        
        if len(self.accounts) >= count:
            logger.info(f"✅ 已有 {len(self.accounts)} 个账号，无需注册")
            return self.accounts[:count]

        # 注册新账号
        to_register = count - len(self.accounts)
        logger.info(f"📝 需要注册 {to_register} 个新账号...")

        for i in range(to_register):
            idx = len(self.accounts) + 1
            display_name = f"AI-Bot-{idx}"
            password = self._generate_password()
            invite_code = invite_codes[i]

            account = self._register_account(display_name, password, invite_code)
            if account:
                self.accounts.append(account)
                self._save_accounts()
            else:
                logger.error(f"❌ 注册失败: {display_name}")
                raise RuntimeError(f"注册账号 {display_name} 失败")

        logger.info(f"✅ 成功注册 {to_register} 个账号，总计 {len(self.accounts)} 个")
        return self.accounts[:count]

    def get_account(self, index: int) -> Account:
        """获取第 N 个账号的认证信息"""
        if index >= len(self.accounts):
            raise IndexError(f"账号索引 {index} 越界，当前仅有 {len(self.accounts)} 个账号")
        return self.accounts[index]

    async def verify_token(self, account: Account) -> bool:
        """验证 token 是否有效"""
        try:
            async with httpx.AsyncClient(base_url=self.server_url) as client:
                response = await client.post("/api/auth/verify", headers={
                    "Authorization": f"Bearer {account.token}"
                })
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"⚠️ Token 验证失败: {e}")
            return False

    async def login_account(self, display_name: str, password: str) -> Optional[Account]:
        """调用登录 API 获取 token"""
        try:
            async with httpx.AsyncClient(base_url=self.server_url) as client:
                response = await client.post("/api/auth/login", json={
                    "displayName": display_name,
                    "password": password,
                })
                result = response.json()
                
                if result.get("success"):
                    account = Account(
                        displayName=display_name,
                        password=password,
                        token=result["token"],
                        playerId=result["player"]["id"],
                    )
                    logger.info(f"✅ 登录成功: {display_name} (ID: {account.playerId})")
                    return account
                else:
                    logger.error(f"❌ 登录失败: {result.get('error')}")
                    return None
        except Exception as e:
            logger.error(f"❌ 登录异常: {e}")
            return None

    def _register_account(self, display_name: str, password: str, invite_code: str) -> Optional[Account]:
        """注册新账号"""
        try:
            with httpx.Client(base_url=self.server_url) as client:
                response = client.post("/api/auth/register", json={
                    "displayName": display_name,
                    "password": password,
                    "inviteCode": invite_code,
                })
                
                # 记录原始响应以便调试
                logger.debug(f"注册响应 - 状态码: {response.status_code}, 内容: {response.text[:500]}")
                
                # 检查 HTTP 状态码
                if response.status_code != 200:
                    try:
                        error_data = response.json()
                        error_msg = error_data.get('error', response.text)
                    except Exception:
                        error_msg = response.text
                    logger.error(f"❌ 注册失败 (HTTP {response.status_code}): {error_msg}")
                    return None
                
                result = response.json()

                if result.get("success"):
                    account = Account(
                        displayName=display_name,
                        password=password,
                        token=result["token"],
                        playerId=result["player"]["id"],
                    )
                    logger.info(f"✅ 注册成功: {display_name} (ID: {account.playerId})")
                    return account
                else:
                    logger.error(f"❌ 注册失败: {result.get('error')}")
                    return None
        except Exception as e:
            logger.error(f"❌ 注册异常: {e}")
            return None

    @staticmethod
    def _generate_password(length: int = 16) -> str:
        """生成随机密码"""
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))
