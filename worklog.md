---
Task ID: 1
Agent: main
Task: Build "代号：黑暗森林" (Dark Forest) web card game

Work Log:
- Analyzed game rules from 游戏规则.md (Three-Body Problem themed card game)
- Extracted card images from images.zip to public folder
- Created game type definitions (types.ts)
- Created card definitions from YAML (cards.ts) - 70 cards total
- Created star map data with 9 systems and 14 connections (starmap.ts)
- Built game engine with full turn flow, card effects, combat resolution (engine.ts)
- Built AI player logic with simple strategy (engine.ts)
- Created Zustand game state store (gameStore.ts)
- Built Star Map SVG component with interactive system selection
- Built Game Card component with tooltips and type-based styling
- Built Player Hand with action modes (broadcast, strike, deploy, exchange, recycle)
- Built Opponent panels showing AI player status
- Built Game Log with color-coded entries
- Built Game Setup screen with player configuration
- Built Game Over screen with rankings
- Built Strike Move Dialog and Announce Strike Dialog
- Built Broadcast Response Dialog and Broadcast Select Responder Dialog
- Built main Game Board layout combining all components
- Fixed multiple bugs: broken deployCard, unused imports, AI broadcast flow
- Deterministic background stars for stable rendering

Stage Summary:
- Fully playable single-player vs AI card game (3-5 players)
- 4 card types: Broadcast, Strike, Defense, Facility
- Star map with 9 interconnected systems
- Complete turn structure: Settlement → Draw → Action
- Broadcast negotiation system with cooperation/disguise mechanics
- Strike movement system with pathfinding AI
- Defense and facility deployment
- Card exchange and recycling mechanics
- Win conditions: Last civilization standing or eternal darkness (draw)
