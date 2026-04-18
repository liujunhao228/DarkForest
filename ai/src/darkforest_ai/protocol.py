"""
黑暗森林 - 网络协议定义
=====================
定义客户端与服务器之间的所有消息格式
=====================
"""

# ============================
# 版本信息
# ============================

PROTOCOL_VERSION = '1.0.0'

# ============================
# 事件名称常量
# ============================

class ClientEvents:
    PLAYER_LOGIN = 'player:login'
    PLAYER_LOGOUT = 'player:logout'
    
    MATCH_JOIN_QUEUE = 'match:joinQueue'
    MATCH_CANCEL_QUEUE = 'match:cancelQueue'
    MATCH_GET_STATUS = 'match:getStatus'
    MATCH_JOIN_SPECIFIC_QUEUE = 'match:joinSpecificQueue'
    MATCH_CREATE_QUEUE = 'match:createQueue'
    MATCH_LEAVE_SPECIFIC_QUEUE = 'match:leaveSpecificQueue'
    MATCH_GET_QUEUE_INFO = 'match:getQueueInfo'
    MATCH_GET_MY_QUEUES = 'match:getMyQueues'
    
    ROOM_JOIN = 'room:join'
    ROOM_LEAVE = 'room:leave'
    ROOM_READY = 'room:ready'
    ROOM_START = 'room:start'
    
    GAME_ACTION = 'game:action'
    GAME_REQUEST_SYNC = 'game:requestSync'
    GAME_ACK_STATE = 'game:ackState'


class ServerEvents:
    PLAYER_LOGIN_SUCCESS = 'player:loginSuccess'
    PLAYER_LOGIN_ERROR = 'player:loginError'
    
    MATCH_QUEUE_JOINED = 'match:queueJoined'
    MATCH_QUEUE_CANCELLED = 'match:queueCancelled'
    MATCH_QUEUE_ERROR = 'match:queueError'
    MATCH_QUEUE_STATUS = 'match:queueStatus'
    MATCH_FOUND = 'match:found'
    MATCH_QUEUE_CREATED = 'match:queueCreated'
    MATCH_SPECIFIC_QUEUE_JOINED = 'match:specificQueueJoined'
    MATCH_SPECIFIC_QUEUE_LEFT = 'match:specificQueueLeft'
    MATCH_QUEUE_INFO_RESPONSE = 'match:queueInfoResponse'
    MATCH_MY_QUEUES_RESPONSE = 'match:myQueuesResponse'
    MATCH_QUEUE_UPDATE = 'match:queueUpdate'
    MATCH_QUEUE_RESTORED = 'match:queueRestored'
    MATCH_ERROR = 'match:error'
    
    ROOM_JOINED = 'room:joined'
    ROOM_ERROR = 'room:error'
    ROOM_PLAYER_JOINED = 'room:playerJoined'
    ROOM_PLAYER_LEFT = 'room:playerLeft'
    ROOM_PLAYER_DISCONNECTED = 'room:playerDisconnected'
    ROOM_PLAYER_READY = 'room:playerReady'
    ROOM_GAME_STARTING = 'room:gameStarting'
    ROOM_HOST_CHANGED = 'room:hostChanged'
    
    GAME_FULL_SYNC = 'game:fullSync'
    GAME_DELTA_SYNC = 'game:deltaSync'
    GAME_ACTION_RESULT = 'game:actionResult'
    GAME_ERROR = 'game:error'
    
    GAME_TURN_START = 'game:turnStart'
    GAME_TURN_END = 'game:turnEnd'
    GAME_PHASE_CHANGE = 'game:phaseChange'
    GAME_PLAYER_ACTION = 'game:playerAction'
    GAME_BROADCAST_REQUEST = 'game:broadcastRequest'
    GAME_STRIKE_MOVE_REQUEST = 'game:strikeMoveRequest'
    GAME_GAME_OVER = 'game:gameOver'


# ============================
# 动作类型
# ============================

class ActionType:
    PLAY_CARD = 'playCard'
    MOVE_STRIKE = 'moveStrike'
    END_TURN = 'endTurn'
    RESPOND_BROADCAST = 'respondBroadcast'
    SELECT_RESPONDER = 'selectResponder'
    ANNOUNCE_STRIKE = 'announceStrike'
    SKIP_ANNOUNCE_STRIKE = 'skipAnnounceStrike'
    RECYCLE_CARD = 'recycleCard'
    USE_LIGHTSPEED_SHIP = 'useLightspeedShip'
    DISCARD_CARDS = 'discardCards'
    CANCEL_BROADCAST = 'cancelBroadcast'


# ============================
# 错误码
# ============================

class ErrorCode:
    # 通用错误
    INTERNAL_ERROR = 'INTERNAL_ERROR'
    IS_PROCESSING = 'IS_PROCESSING'
    UNKNOWN_ACTION = 'UNKNOWN_ACTION'
    
    # 认证错误
    AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING'
    AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID'
    PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND'
    
    # 卡牌相关错误
    CARD_NOT_FOUND = 'CARD_NOT_FOUND'
    CARD_NOT_IN_HAND = 'CARD_NOT_IN_HAND'
    NOT_BROADCAST_CARD = 'NOT_BROADCAST_CARD'
    
    # 能量相关错误
    NOT_ENOUGH_ENERGY = 'NOT_ENOUGH_ENERGY'
    
    # 目标相关错误
    MISSING_TARGET = 'MISSING_TARGET'
    MISSING_TARGET_PLAYER = 'MISSING_TARGET_PLAYER'
    
    # 回合/阶段错误
    NOT_YOUR_TURN = 'NOT_YOUR_TURN'
    INVALID_PHASE = 'INVALID_PHASE'
    
    # 广播博弈错误
    NO_ACTIVE_BROADCAST = 'NO_ACTIVE_BROADCAST'
    RECENT_BROADCAST = 'RECENT_BROADCAST'
    BROADCAST_NOT_CREATED = 'BROADCAST_NOT_CREATED'
    CANNOT_RESPOND = 'CANNOT_RESPOND'
    ALREADY_RESPONDED = 'ALREADY_RESPONDED'
    NOT_BROADCASTER = 'NOT_BROADCASTER'
    ALREADY_SELECTED = 'ALREADY_SELECTED'
    INVALID_RESPONDER = 'INVALID_RESPONDER'
    NO_BROADCAST = 'NO_BROADCAST'
    INITIATE_FAILED = 'INITIATE_FAILED'
    RESPOND_FAILED = 'RESPOND_FAILED'
    SELECT_FAILED = 'SELECT_FAILED'
    RESOLVE_FAILED = 'RESOLVE_FAILED'
    
    # 房间相关错误
    ROOM_NOT_FOUND = 'ROOM_NOT_FOUND'
    ROOM_FULL = 'ROOM_FULL'
    ROOM_GAME_STARTED = 'ROOM_GAME_STARTED'
    NOT_HOST = 'NOT_HOST'
    
    # 匹配相关错误
    ALREADY_IN_QUEUE = 'ALREADY_IN_QUEUE'
    QUEUE_NOT_FOUND = 'QUEUE_NOT_FOUND'
    INVALID_PLAYER_COUNT = 'INVALID_PLAYER_COUNT'
