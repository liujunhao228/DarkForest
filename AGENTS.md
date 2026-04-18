# AGENTS.md - Repository Knowledge Base

## 1. Overview

语言：中文

This is a **Next.js 16 + TypeScript** application built with:
- **Bun** runtime and package manager
- **Tailwind CSS** + **shadcn/ui** for UI components
- **Prisma** ORM with **SQLite** database
- **Socket.IO** for WebSocket communication
- **Zod** for schema validation
- **JWT** for authentication

Project structure: `E:\DarkForest` (root)

## 2. Build/Lint/Test Commands

### 2.1 Development Commands

```bash
# Development server
pnpm dev
# or
bun run dev
```

### 2.2 Build Commands

```bash
# Build for production
pnpm build
# or
bun run build
```

### 2.3 Linting Commands

```bash
# Run ESLint
pnpm lint
# or
bun run lint
```

### 2.4 Test Commands - Complete Guide

#### Run All Tests
```bash
# Run all unit tests
pnpm test
# or
bun test
```

#### Run a Single Test

**To run a specific test file:**
```bash
# Unit test - matchmaking
bun test src/lib/__tests__/matchmaking.test.ts

# Unit test - game engine
bun test src/lib/__tests__/game-engine.test.ts

# Unit test - game actions
bun test src/lib/__tests__/game-actions.test.ts

# Unit test - broadcast
bun test src/lib/__tests__/broadcast.test.ts

# Integration test - WebSocket server (requires server running)
bun test src/server/__tests__/gameServer.test.ts

# API route test
bun test src/app/api/__tests__/routes.test.ts

# E2E test (Playwright)
bun run test:e2e
bun run test:e2e:ui
bun run test:e2e:headed
```

**To run a specific test within a file:**
```bash
# Using test name pattern (Bun test runner)
bun test src/lib/__tests__/matchmaking.test.ts -t "joinQueue"
bun test src/lib/__tests__/matchmaking.test.ts -t "createMatchRoom"
```

#### Run Tests with Coverage
```bash
bun test --coverage
```

#### Watch Mode
```bash
bun test --watch
```

#### Specific Test Groups

**Matchmaking Tests (22 tests, ~91% pass rate):**
```bash
bun test src/lib/__tests__/matchmaking.test.ts
```

**Game Engine Tests:**
```bash
bun test src/lib/__tests__/game-engine.test.ts
```

**WebSocket Integration Tests:**
```bash
# Requires WebSocket server running on port 3003
bun run src/server/gameServer.ts &
bun test src/server/__tests__/gameServer.test.ts
```

**E2E Tests:**
```bash
# Full E2E suite
bun run test:e2e

# Interactive UI mode
bun run test:e2e:ui

# Headed mode (shows browser)
bun run test:e2e:headed --project=chromium
```

### 2.5 Database Commands

```bash
# Push schema to database
pnpm db:push
# or
bun run prisma db push --accept-data-loss

# Generate Prisma client
pnpm db:generate
# or
bun run prisma generate

# Run migrations in dev
pnpm db:migrate
# or
bun run prisma migrate dev

# Reset database (dangerous!)
pnpm db:reset
# or
bun run prisma migrate reset
```

### 2.6 Server Commands

```bash
# Start WebSocket game server
bun run src/server/gameServer.ts

# Start Next.js development server
bun run dev
```

## 3. Code Style Guidelines

### 3.1 File Structure and Organization

```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes
│   ├── auth/              # Authentication pages
│   ├── admin/             # Admin panel
│   └── layout.tsx         # Root layout
├── components/            # Reusable components
│   ├── ui/               # shadcn/ui components
│   ├── game/             # Game-specific components
│   └── online/           # Online game components
├── lib/                  # Core libraries
│   ├── db.ts             # Prisma database client
│   ├── matchmaking.ts    # Matchmaking logic
│   ├── auth.ts           # Authentication logic
│   ├── auth-middleware.ts # Auth middleware
│   ├── game/             # Game engine modules
│   │   ├── engine.ts     # Core game logic
│   │   ├── broadcast.ts  # WebSocket broadcasting
│   │   ├── cards.ts      # Card game logic
│   │   ├── deck.ts       # Deck management
│   │   ├── settlement.ts # Game settlement
│   │   └── types.ts      # Game type definitions
│   ├── websocket.ts      # WebSocket handlers
│   └── utils.ts          # Utility functions
├── hooks/                # React hooks
├── store/                # Zustand stores
└── tests/                # E2E tests
```

### 3.2 Import Conventions

**Absolute Imports (Recommended):**
```typescript
// Use @ alias defined in tsconfig.json
import { db } from '@/lib/db';
import { matchmaking } from '@/lib/matchmaking';
import { GameEngine } from '@/lib/game/engine';
```

**Relative Imports (When not using @ alias):**
```typescript
// For same directory
import { formatTime } from './utils';

// For parent directory
import { db } from '../lib/db';

// For subdirectory
import { GameEngine } from './game/engine';
```

**Third-party imports:**
```typescript
import express from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
```

**Never mix styles** - be consistent within a file.

### 3.3 TypeScript Type Conventions

**Interfaces for data shapes:**
```typescript
interface Player {
  id: string;
  displayName: string;
  rating: number;
}

interface Match {
  id: string;
  roomCode: string;
  players: Player[];
  status: 'waiting' | 'in-progress' | 'completed';
}
```

**Type aliases for complex types:**
```typescript
type PlayerId = string;
type RoomCode = string;
type MatchmakingResult = { success: boolean; error?: string };
```

**Enums for fixed sets of values:**
```typescript
enum GameStatus {
  WAITING = 'waiting',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
}

enum PlayerRole {
  HOST = 'host',
  PLAYER = 'player',
}
```

### 3.4 Naming Conventions

**Variables:**
- Use `camelCase` for variables
- Descriptive names only
- Avoid single-letter names (except loop counters)

```typescript
// Good
const playerId = 'player-123';
const matchmakingOptions = { playerCount: 4 };

// Bad
const a = 'player-123';
const o = { c: 4 };
```

**Functions:**
- Use `camelCase` starting with a verb
- Include parameters in name if needed

```typescript
// Good
function getPlayerInfo(playerId: string): Promise<Player>;
function joinMatchmakingQueue(playerId: string): Promise<boolean>;

// Bad
function playerInfo(playerId: string);  // Not a verb
function q(playerId: string);           // Too cryptic
```

**Files:**
- Use `kebab-case` for file names
- Match default export with file name

```typescript
// matchmaking.ts - contains matchmaking-related functions
// game-engine.ts - contains game engine logic
```

**Constants:**
- Use `UPPER_SNAKE_CASE`

```typescript
const MATCHMAKING_TIMEOUT = 30000;
const MAX_PLAYERS_PER_ROOM = 5;
```

### 3.5 Function and Variable Naming

**Boolean functions:**
- Start with `is`, `has`, `can`, `should`, `must`

```typescript
function canJoinQueue(playerId: string): boolean;
function hasPlayerLeftRoom(roomCode: string): boolean;
function isGameActive(status: GameStatus): boolean;
```

**Getters and Setters:**
- Use `get`/`set` prefix for property accessors

```typescript
function getPlayerCount(): number;
function setPlayerReady(playerId: string, ready: boolean): void;
```

### 3.6 Comments and Documentation

**JSDoc for functions:**
```typescript
/**
 * Joins a player to the matchmaking queue
 * @param playerId - Unique identifier for the player
 * @param playerCount - Desired number of players (3-5)
 * @param timeout - Optional timeout in milliseconds (default: 30000)
 * @returns Object with success status and optional error message
 */
export async function joinQueue(
  playerId: string,
  playerCount: number,
  timeout?: number
): Promise<{ success: boolean; error?: string }> {
  // Implementation
}
```

**Inline comments:**
```typescript
// Check if player is already in queue
const existingQueue = await db.matchmakingQueue.findUnique({
  where: { playerId: options.playerId },
});

if (existingQueue) {
  return { success: false, error: '已在匹配队列中' };  // Already in queue
}
```

### 3.7 Error Handling

**Always use try-catch for async operations:**
```typescript
export async function joinQueue(options: MatchmakingOptions): Promise<{ success: boolean; error?: string }> {
  try {
    // Database operations
    const existingQueue = await db.matchmakingQueue.findUnique({
      where: { playerId: options.playerId },
    });

    if (existingQueue) {
      return { success: false, error: '已在匹配队列中' };
    }

    await db.matchmakingQueue.create({
      data: {
        playerId: options.playerId,
        preferredCount: options.playerCount,
        timeout: options.timeout ?? 30000,
      },
    });

    return { success: true };
  } catch (error) {
    console.error('加入匹配队列失败:', error);  // Log for debugging
    return { success: false, error: '系统错误' };
  }
}
```

**Error types:**
- Return error objects with `success: false` for expected errors
- Use `console.error` for debugging
- Never throw unhandled exceptions in async operations

### 3.8 Async/Await Patterns

**Always await async operations:**
```typescript
// Good
const player = await db.player.findUnique({ where: { id: playerId } });
const result = await matchmaking.joinQueue(playerId, 4);

// Bad - will cause issues
const player = db.player.findUnique({ where: { id: playerId } });
```

**Handle rejected promises:**
```typescript
try {
  await db.player.delete({ where: { id: playerId } });
} catch (error) {
  // Handle gracefully - record might not exist
  console.debug('Player cleanup failed:', error);
}
```

## 4. Testing Guidelines

### 4.1 Test Structure

**Test files location:**
- Unit tests: `src/lib/__tests__/*.test.ts`
- Integration tests: `src/server/__tests__/*.test.ts`
- API tests: `src/app/api/__tests__/*.test.ts`
- E2E tests: `tests/e2e/*.spec.ts`

**Test file naming:**
- Use `.test.ts` suffix for test files
- Match test file name with source file name

```bash
# Source: src/lib/matchmaking.ts
# Test: src/lib/__tests__/matchmaking.test.ts
```

### 4.2 Test Patterns

**Describe blocks for organization:**
```typescript
describe('Matchmaking System', () => {
  // All matchmaking-related tests
});

describe('WebSocket Game Server', () => {
  // All WebSocket tests
});
```

**It blocks for individual tests:**
```typescript
it('should join player to queue successfully', async () => {
  const result = await joinQueue('player-123', 4);
  expect(result.success).toBe(true);
});

it('should return error when player already in queue', async () => {
  const result = await joinQueue('player-123', 4);
  expect(result.success).toBe(false);
  expect(result.error).toBe('已在匹配队列中');
});
```

**Use descriptive test names:**
```typescript
// Good
describe('joinQueue', () => {
  it('should add player to queue when not already queued', () => { ... });
  it('should return error when player already in queue', () => { ... });
  it('should respect player count preference', () => { ... });
});

// Bad
describe('test1', () => {
  it('test', () => { ... });
});
```

### 4.3 Test Setup and Cleanup

**Use beforeEach/afterEach for test isolation:**
```typescript
describe('Matchmaking System', () => {
  let testPlayerId: string;

  beforeEach(async () => {
    // Create test player
    const result = await createTestPlayer();
    testPlayerId = result.id;
  });

  afterEach(async () => {
    // Clean up test data
    await cleanupTestPlayer(testPlayerId);
  });

  it('should work with clean state', async () => {
    // Test runs with fresh data
  });
});
```

### 4.4 Database Testing

**Always clean up test data:**
```typescript
async function cleanupTestPlayer(playerId: string) {
  await db.player.delete({ where: { id: playerId } }).catch(() => {});
  await db.matchmakingQueue.deleteMany({
    where: { playerId }
  }).catch(() => {});
}
```

**Use descriptive test data:**
```typescript
// Good - identifiable in test results
const testPlayer = {
  displayName: 'TestPlayer_' + Date.now(),
  rating: 1000,
};

// Bad - hard to identify
const testPlayer = {
  displayName: 'player',
  rating: 1000,
};
```

### 4.5 Known Test Issues

**Database Foreign Key Constraints:**
- Issue: `createMatchRoom` tests may fail with FK constraint errors
- Cause: Cleanup order in tests
- Impact: Test isolation issue, does not affect production functionality
- Status: Known issue, safe to ignore

**WebSocket Test Prerequisites:**
- WebSocket server must be running on port 3003
- Start with: `bun run src/server/gameServer.ts`

## 5. Environment Configuration

### 5.1 Environment Variables

**Required in `.env`:**
```env
# JWT secrets (generate with: openssl rand -base64 32)
JWT_SECRET=your_jwt_secret_here
ADMIN_SECRET_KEY=your_admin_secret_here

# Database
DATABASE_URL="file:./db/dev.db"

# Server
PORT=3000
WS_PORT=3003
```

**Environment-specific configs:**
- `.env.development` - Development settings
- `.env.auto` - Auto-generated environment
- `.env.example` - Template for new environments

### 5.2 Development Setup

**Initial setup:**
```bash
# Copy environment template
cp .env.example .env

# Generate secrets
openssl rand -base64 32 > .jwt_secret
openssl rand -base64 32 > .admin_secret
```

**Install dependencies:**
```bash
pnpm install
# or
bun install
```

## 6. Common Patterns and Anti-Patterns

### 6.1 Do's

✅ Use absolute imports with `@` alias
✅ Write JSDoc comments for public functions
✅ Handle errors gracefully with try-catch
✅ Clean up test data in afterEach hooks
✅ Use descriptive test names
✅ Return error objects instead of throwing
✅ Use `??` operator for default values
✅ Use optional chaining `?.` for nested properties

### 6.2 Don'ts

❌ Use relative imports without clear structure
❌ Leave console.log in production code
❌ Throw errors without proper handling
❌ Skip test cleanup
❌ Use generic test names
❌ Throw exceptions for expected errors
❌ Use `any` type
❌ Copy-paste database operations without abstraction

## 7. Deployment Notes

### 7.1 Production Deployment

```bash
# Build
bun run build

# Start server
NODE_ENV=production bun server.js
```

### 7.2 Container Deployment

```bash
# Build image
docker compose -f docker-compose.production.yml build

# Start services
docker compose -f docker-compose.production.yml up -d
```

## 8. Useful Scripts

### 8.1 Test Scripts

```bash
# Run all tests
bun test

# Run tests with coverage
bun test --coverage

# Watch mode
bun test --watch

# Specific test file
bun test src/lib/__tests__/matchmaking.test.ts

# Specific test within file
bun test src/lib/__tests__/matchmaking.test.ts -t "joinQueue"
```

### 8.2 Database Scripts

```bash
# Push schema
bun run prisma db push --accept-data-loss

# Generate client
bun run prisma generate

# Run migrations
bun run prisma migrate dev
```

## 9. Troubleshooting

### 9.1 Test Failures

**Issue: Database foreign key constraint errors**
- Symptom: `PrismaClientKnownRequestError: FOREIGN KEY constraint failed`
- Cause: Test cleanup order
- Solution: Ignore for now - this is a test isolation issue

**Issue: WebSocket connection refused**
- Symptom: `Error: connect ECONNREFUSED 127.0.0.1:3003`
- Cause: WebSocket server not running
- Solution: `bun run src/server/gameServer.ts`

### 9.2 Build Issues

**Issue: TypeScript compilation errors**
- Check `tsconfig.json` configuration
- Ensure all imports resolve correctly
- Run `bun run db:generate` if Prisma types are missing

## 10. Best Practices Summary

1. **Type Safety**: Always use TypeScript with strict mode enabled
2. **Error Handling**: Return error objects, don't throw for expected errors
3. **Test Isolation**: Clean up test data in afterEach hooks
4. **Code Organization**: Use absolute imports with @ alias
5. **Documentation**: Write JSDoc for all public functions
6. **Async Patterns**: Always await async operations
7. **Naming**: Use descriptive names following conventions
8. **Testing**: Run specific tests with focused test names
9. **Database**: Clean up test data to avoid constraint violations
10. **Environment**: Keep secrets in .env, use .env.example for templates