package server

import (
	"context"
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/semantic"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// resources.go 注册 4 类静态知识 Resource(数据型),供 Agent 按 URI 寻址读取。
//
// 设计意图(Spec 决策):静态知识采取 Resource(数据型)+ Prompt(叙述型)混用。
// Resource 用于结构化、按 URI 寻址的静态知识,Agent 按需读取,避免在每次 tool
// 调用中挤占上下文。
//
// 4 类 Resource(共 8 个独立 URI):
//   1. starmap://topology               — 星图拓扑(9 节点 + 14 边 + 邻接矩阵)
//   2. cards://library                  — 卡牌库(19 张卡牌完整定义)
//   3. rules://mode/{mode}              — 模式规则(2 个:classic / civilization_relics)
//   4. rules://mechanism/{name}         — 机制规则(4 个:strike/broadcast/lightspeed/relic)
//
// 注册策略:URI 模板按独立 Resource 注册(而非 ResourceTemplate),便于 Agent 通过
// list resources 直接发现所有可读 URI,无需构造模板 URI。
//
// 数据源:全部来自 semantic 包(硬编码镜像后端 game 包),不依赖 GameSession 状态,
// 无需 session/account 依赖,故放在 server 包内最简洁。

// RegisterResources 注册所有静态知识 Resource 到 MCP Server。
// 本函数仅注册 Resource,不依赖 session/account,由编排者在 server.go 中调用。
//
// 注意:本函数不修改 server.go,注册行由编排者统一添加。
func RegisterResources(server *mcp.Server) {
	registerStarMapTopology(server)
	registerCardLibrary(server)
	registerModeRules(server)
	registerMechanismRules(server)
}

// --- 1. starmap://topology ---

// registerStarMapTopology 注册星图拓扑 Resource。
// 返回 9 个节点 + 14 条边 + 9x9 邻接矩阵的 JSON 数据。
func registerStarMapTopology(server *mcp.Server) {
	server.AddResource(
		&mcp.Resource{
			URI:         "starmap://topology",
			Name:        "星图拓扑",
			Description: "9 个星系节点 + 14 条边 + 邻接矩阵。节点 ID 范围 1-9,边定义星系间跃迁可达关系。",
			MIMEType:    "application/json",
		},
		func(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return readJSON(req, semantic.GetStarMapTopology())
		},
	)
}

// --- 2. cards://library ---

// registerCardLibrary 注册卡牌库 Resource。
// 返回 19 张卡牌完整定义(broadcast/strike/defense/facility 四类)的 JSON 数据。
func registerCardLibrary(server *mcp.Server) {
	server.AddResource(
		&mcp.Resource{
			URI:         "cards://library",
			Name:        "卡牌库",
			Description: "19 张卡牌完整定义(broadcast/strike/defense/facility 四类),含 ID/Name/Type/Energy/Quantity/Description/Extended。",
			MIMEType:    "application/json",
		},
		func(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
			return readJSON(req, semantic.ListAllCardDefs())
		},
	)
}

// --- 3. rules://mode/{mode} ---

// registerModeRules 注册模式规则 Resource(2 个独立 URI)。
// 每个模式返回对应 ModeRules 结构的 JSON,字段对齐后端 game.ModeRules。
func registerModeRules(server *mcp.Server) {
	for _, mode := range []string{semantic.ModeClassic, semantic.ModeCivilizationRelics} {
		rules, ok := semantic.GetModeRules(mode)
		if !ok {
			continue
		}
		// 局部副本,避免闭包捕获循环变量。
		r := rules
		server.AddResource(
			&mcp.Resource{
				URI:         "rules://mode/" + mode,
				Name:        "模式规则-" + mode,
				Description: r.Description,
				MIMEType:    "application/json",
			},
			func(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
				return readJSON(req, r)
			},
		)
	}
}

// --- 4. rules://mechanism/{name} ---

// registerMechanismRules 注册机制规则 Resource(4 个独立 URI)。
// 每个机制返回中文事实陈述文本(text/plain),禁用行动指导词。
func registerMechanismRules(server *mcp.Server) {
	for _, name := range semantic.ListMechanismNames() {
		text, ok := semantic.GetMechanismRule(name)
		if !ok {
			continue
		}
		// 局部副本,避免闭包捕获循环变量。
		t := text
		n := name
		server.AddResource(
			&mcp.Resource{
				URI:         "rules://mechanism/" + n,
				Name:        "机制规则-" + n,
				Description: mechanismDescription(n),
				MIMEType:    "text/plain",
			},
			func(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
				return &mcp.ReadResourceResult{
					Contents: []*mcp.ResourceContents{
						{
							URI:      req.Params.URI,
							MIMEType: "text/plain",
							Text:     t,
						},
					},
				}, nil
			},
		)
	}
}

// mechanismDescription 返回机制规则的 Description 文本(事实陈述,禁用行动指导词)。
// 与 mechanism_rules.go 中的正文配套,Description 用于 list resources 时的摘要展示。
func mechanismDescription(name string) string {
	switch name {
	case "strike":
		return "打击机制规则:5 类打击卡(热核/光粒/湮灭/降维/科技锁死)、飞行移动、ETA 计算、威胁等级、模式差异、落空处理。"
	case "broadcast":
		return "广播机制规则:合作/伪装两类、3 种范围(恒星/宇宙/超距)、响应阶段(waiting/select/reveal)、响应规则、物理牌数量。"
	case "lightspeed":
		return "光速飞船机制规则:Classic 一次性 vs Relics 多次、跃迁方式(随机)、能量消耗、携带上限、留言机制。"
	case "relic":
		return "遗迹机制规则(仅 Relics 模式):遗迹发现、私有揭示、继承规则、能量与设施继承、BroadcastOnInherit 控制。"
	default:
		return ""
	}
}

// readJSON 把 v 序列化为 JSON 并包装为 ReadResourceResult。
// 用于返回 application/json 类型的 Resource 内容。
func readJSON(req *mcp.ReadResourceRequest, v any) (*mcp.ReadResourceResult, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("序列化 Resource 数据失败: %w", err)
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{
			{
				URI:      req.Params.URI,
				MIMEType: "application/json",
				Text:     string(data),
			},
		},
	}, nil
}
