// ============================
// WebSocket ?????????
// ============================

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { io, type Socket } from 'socket.io-client';
import { db } from '@/lib/db';

const TEST_SERVER_URL = 'http://localhost:3003';

describe('WebSocket Game Server', () => {
  let testSockets: Socket[] = [];
  let testUsers: Array<{ id: string; userId: string; displayName: string }> = [];

  // ??????
  async function cleanup() {
    // ?????? socket
    testSockets.forEach(socket => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
    testSockets = [];

    // ??????
    const testPlayers = await db.player.findMany({
      where: {
        displayName: { contains: 'WebSocketTest_' },
      },
    });

    for (const player of testPlayers) {
      await db.player.delete({ where: { id: player.id } }).catch(() => {});
    }

    // ??????
    const testMatches = await db.match.findMany({
      where: { roomCode: { contains: 'WSTEST' } },
    });

    for (const match of testMatches) {
      await db.match.delete({ where: { id: match.id } }).catch(() => {});
    }

    // ??????
    await db.matchmakingQueue.deleteMany({
      where: {
        playerId: { in: testUsers.map(u => u.id).filter(Boolean) },
      },
    }).catch(() => {});

    testUsers = [];
  }

  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  // ??????
  async function createTestPlayer(name: string) {
    const userId = `wstest_user_${name}_${Date.now()}`;

    const player = await db.player.create({
      data: {
        userId,
        displayName: `WebSocketTest_${name}`,
      },
    });

    return { id: player.id, userId, displayName: player.displayName };
  }

  // ???? socket
  function createTestSocket(): Socket {
    const socket = io(TEST_SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    testSockets.push(socket);
    return socket;
  }

  // ???? Promise
  function waitForEvent(socket: Socket, event: string, timeout = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      socket.once(event, (data: unknown) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  describe('Connection', () => {
    it('?????? WebSocket ???', (done) => {
      const socket = createTestSocket();

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        done();
      });

      socket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('????????', (done) => {
      const socket = createTestSocket();

      socket.on('connect', () => {
        socket.disconnect();
      });

      socket.on('disconnect', () => {
        expect(socket.connected).toBe(false);
        done();
      });
    });
  });

  describe('Player Login', () => {
    it('????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('Login');

      // ????
      await waitForEvent(socket, 'connect');

      // ??????
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });

      // ??????
      const response = await waitForEvent(socket, 'player:loggedIn') as { playerId: string; displayName: string };

      expect(response.playerId).toBe(testUser.id);
      expect(response.displayName).toBe(testUser.displayName);
    });

    it('???????????', async () => {
      const socket = createTestSocket();

      await waitForEvent(socket, 'connect');

      // ?????????
      socket.emit('player:login', {
        userId: 'invalid-user-id',
        displayName: 'Invalid User',
      });

      // ??????
      const response = await waitForEvent(socket, 'error') as { message: string };
      expect(response.message).toBeDefined();
    });
  });

  describe('Matchmaking Queue', () => {
    it('??????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('Queue1');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ????
      socket.emit('match:joinQueue', {
        mode: 'casual',
        playerCount: 4,
      });

      // ??????
      const response = await waitForEvent(socket, 'match:queueJoined') as {
        mode: string;
        playerCount: number;
        position: number;
      };

      expect(response.mode).toBe('casual');
      expect(response.playerCount).toBe(4);
      expect(response.position).toBe(1);
    });

    it('??????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('QueueCancel');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ????
      socket.emit('match:joinQueue', {
        mode: 'casual',
        playerCount: 4,
      });
      await waitForEvent(socket, 'match:queueJoined');

      // ????
      socket.emit('match:cancelQueue');

      // ??????
      await waitForEvent(socket, 'match:queueCancelled');
    });

    it('?????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('QueueDup');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ?????
      socket.emit('match:joinQueue', {
        mode: 'casual',
        playerCount: 4,
      });
      await waitForEvent(socket, 'match:queueJoined');

      // ?????????
      socket.emit('match:joinQueue', {
        mode: 'ranked',
        playerCount: 3,
      });

      const response = await waitForEvent(socket, 'match:queueError') as { message: string };
      expect(response.message).toBe('???????');
    });
  });

  describe('Match Found', () => {
    it('??????????', async () => {
      // ?? 4 ???? socket
      const sockets: Socket[] = [];
      const users: Array<{ id: string; userId: string; displayName: string }> = [];

      for (let i = 1; i <= 4; i++) {
        const socket = createTestSocket();
        const user = await createTestPlayer(`Match${i}`);
        sockets.push(socket);
        users.push(user);

        await waitForEvent(socket, 'connect');

        // ??
        socket.emit('player:login', {
          userId: user.userId,
          displayName: user.displayName,
        });
        await waitForEvent(socket, 'player:loggedIn');

        // ????
        socket.emit('match:joinQueue', {
          mode: 'casual',
          playerCount: 4,
        });
      }

      // ????????????????????
      const matchPromises = sockets.map(socket =>
        waitForEvent(socket, 'match:found', 15000)
      );

      const results = await Promise.all(matchPromises);

      // ???????????????
      results.forEach((result: unknown) => {
        const matchResult = result as {
          roomId: string;
          roomCode: string;
          players: unknown[];
          isHost: boolean;
        };
        expect(matchResult.roomId).toBeDefined();
        expect(matchResult.roomCode).toBeDefined();
        expect(matchResult.players.length).toBe(4);
      });

      // ??????????
      const firstResult = results[0] as { isHost: boolean };
      expect(firstResult.isHost).toBe(true);
    });
  });

  describe('Room Management', () => {
    it('??????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('RoomJoin');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ??????????
      socket.emit('room:join', { roomCode: 'INVALID' });

      const response = await waitForEvent(socket, 'room:error') as { message: string };
      expect(response.message).toBe('?????');
    });

    it('??????????', async () => {
      // ??????????????
      // ????????????????????
      const socket = createTestSocket();
      const testUser = await createTestPlayer('RoomReady');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ??????????????
      socket.emit('room:ready', { roomId: 'invalid', ready: true });

      // ??????????????
      // ??????????
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Game Actions', () => {
    it('???????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('GameInit');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ?????????????
      socket.emit('game:init', { roomId: 'invalid' });

      // ??????????????
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('GameAction');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ????????????
      socket.emit('game:action', {
        roomId: 'invalid',
        action: 'playCard',
        payload: { cardUid: 'test' },
      });

      // ??????????????
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('Disconnect Handling', () => {
    it('??????????', async () => {
      const socket = createTestSocket();
      const testUser = await createTestPlayer('Disconnect');

      await waitForEvent(socket, 'connect');

      // ??
      socket.emit('player:login', {
        userId: testUser.userId,
        displayName: testUser.displayName,
      });
      await waitForEvent(socket, 'player:loggedIn');

      // ????
      socket.disconnect();

      expect(socket.connected).toBe(false);
    });
  });
});
