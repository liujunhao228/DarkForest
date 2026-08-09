package tools

import (
	"context"
	"strings"
	"testing"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/persistence"
)

// newAdminTestPool 用真实 SQLite 起一个账户池(registrar=nil,避免网络)。
func newAdminTestPool(t *testing.T, trust bool) *account.Pool {
	t.Helper()
	db, err := persistence.Open(t.TempDir() + "/admin.db")
	if err != nil {
		t.Fatalf("persistence.Open 失败: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return account.NewPool(db.Account, nil, trust)
}

// TestAdminAddPoolAgent 验证 add_pool_agent 加入的 agent 在
// list_pool_agents 与 list_pool_accounts 中均可见。
func TestAdminAddPoolAgent(t *testing.T) {
	ctx := context.Background()
	p := newAdminTestPool(t, false)

	_, out, err := handleAddPoolAgent(p)(ctx, nil, AddPoolAgentInput{SID: "agent_1"})
	if err != nil {
		t.Fatalf("add_pool_agent err: %v", err)
	}
	if !out.Added || out.AgentID != "agent:agent_1" {
		t.Fatalf("add_pool_agent 输出异常: %+v", out)
	}

	_, listOut, err := handleListPoolAgents(p)(ctx, nil, ListPoolAgentsInput{})
	if err != nil {
		t.Fatalf("list_pool_agents err: %v", err)
	}
	var found bool
	for _, a := range listOut.Agents {
		if a.ID == "agent:agent_1" && a.DisplayName == "AI-agent_1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("list_pool_agents 未含 agent:agent_1,实际: %+v", listOut.Agents)
	}

	_, accOut, err := handleListPoolAccounts(p)(ctx, nil, ListPoolAccountsInput{})
	if err != nil {
		t.Fatalf("list_pool_accounts err: %v", err)
	}
	found = false
	for _, a := range accOut.Accounts {
		if a.ID == "agent:agent_1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("list_pool_accounts 未显示 agent,实际: %+v", accOut.Accounts)
	}
}

// TestAdminWebDisabled_Trust 验证 trust 下 register_pool_account / add_pool_account
// 返回"信任模式下 web 账号通道已废弃",而非 trust 走原逻辑(registrar 为 nil 则报未配置)。
func TestAdminWebDisabled_Trust(t *testing.T) {
	ctx := context.Background()

	trustPool := newAdminTestPool(t, true)
	_, _, err := handleRegisterPoolAccount(trustPool, "")(ctx, nil, RegisterPoolAccountInput{})
	if err == nil || !strings.Contains(err.Error(), "信任模式下 web 账号通道已废弃") {
		t.Fatalf("trust register_pool_account 应拒绝,err = %v", err)
	}
	_, _, err = handleAddPoolAccount(trustPool)(ctx, nil, AddPoolAccountInput{DisplayName: "x", Password: "y"})
	if err == nil || !strings.Contains(err.Error(), "信任模式下 web 账号通道已废弃") {
		t.Fatalf("trust add_pool_account 应拒绝,err = %v", err)
	}

	// 非 trust:走原注册逻辑(nil registrar → 报"未配置 registrar",而非废弃通道)。
	plain := newAdminTestPool(t, false)
	_, _, err = handleRegisterPoolAccount(plain, "")(ctx, nil, RegisterPoolAccountInput{})
	if err == nil || strings.Contains(err.Error(), "信任模式下 web 账号通道已废弃") {
		t.Fatalf("非 trust register_pool_account 不应返回废弃错误,err = %v", err)
	}
	_, _, err = handleAddPoolAccount(plain)(ctx, nil, AddPoolAccountInput{DisplayName: "x", Password: "y"})
	if err == nil || strings.Contains(err.Error(), "信任模式下 web 账号通道已废弃") {
		t.Fatalf("非 trust add_pool_account 不应返回废弃错误,err = %v", err)
	}
}
