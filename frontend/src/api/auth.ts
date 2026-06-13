import { get, post } from './http';

// ============================
// 类型定义 - 与Go后端响应一致
// ============================

/**
 * 玩家基本信息（登录/注册响应中）
 */
export interface Player {
  id: string;
  displayName: string;
  role: string;
}

/**
 * 玩家详细信息（获取玩家信息响应中）
 */
export interface PlayerInfo {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  avatar: number;
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  createdAt: string;
}

/**
 * 认证响应（登录/注册/管理员初始化）
 */
export interface AuthResponse {
  success: boolean;
  token: string;
  player: Player;
}

/**
 * 登录请求
 */
export interface LoginRequest {
  displayName: string;
  password: string;
}

/**
 * 注册请求
 */
export interface RegisterRequest {
  displayName: string;
  password: string;
  inviteCode: string;
}

/**
 * 管理员初始化请求
 */
export interface AdminSetupRequest {
  displayName: string;
  password: string;
  secret: string;
}

/**
 * 邀请码信息
 */
export interface InvitationInfo {
  id: string;
  code: string;
  createdBy: string;
  isUsed: boolean;
}

/**
 * 创建邀请码响应
 */
export interface CreateInviteResponse {
  success: boolean;
  invitation: InvitationInfo;
}

/**
 * 邀请码列表响应
 */
export interface ListInvitesResponse {
  success: boolean;
  invitations: InvitationInfo[];
}

// ============================
// API 函数
// ============================

export async function login(data: LoginRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/api/auth/login', data);
}

export async function register(data: RegisterRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/api/auth/register', data);
}

export async function adminSetup(data: AdminSetupRequest): Promise<AuthResponse> {
  return post<AuthResponse>('/api/auth/admin-setup', data);
}

export async function createInvite(): Promise<CreateInviteResponse> {
  return post<CreateInviteResponse>('/api/auth/invite', {});
}

export async function listInvites(): Promise<ListInvitesResponse> {
  return get<ListInvitesResponse>('/api/auth/invite');
}