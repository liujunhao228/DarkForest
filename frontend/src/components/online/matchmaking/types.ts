/**
 * Matchmaking 子模块共享类型。
 *
 * 从 onlineStore 推断类型，避免在 store 中添加 export（保持 store 文件不动），
 * 同时保证类型与 store 字段同步演化。
 */

import { useOnlineStore } from '@/store/onlineStore';

type OnlineStore = ReturnType<typeof useOnlineStore.getState>;

/** 当前房间信息（currentRoom 字段类型，已去除 null） */
export type RoomInfo = NonNullable<OnlineStore['currentRoom']>;

/** 当前自定义队列信息（currentQueue 字段类型，已去除 null） */
export type CustomQueueInfo = NonNullable<OnlineStore['currentQueue']>;

/** 房间玩家（RoomInfo.players 元素类型） */
export type RoomPlayer = RoomInfo['players'][number];

/** 队列玩家（CustomQueueInfo.players 元素类型） */
export type QueuePlayer = CustomQueueInfo['players'][number];

/** Matchmaking 三种模式 */
export type MatchmakingMode = 'menu' | 'queue' | 'room';
