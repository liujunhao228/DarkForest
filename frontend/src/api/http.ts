import { getToken, useAuthStore } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || '';
const DEFAULT_TIMEOUT_MS = 15000;

interface RequestOptions extends RequestInit {
  params?: Record<string, string>;
  skipAuth?: boolean;
  timeout?: number;
}

export async function http<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, skipAuth, timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  let url = API_URL + endpoint;

  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const config: RequestInit = {
    ...fetchOptions,
    headers,
    signal: controller.signal,
  };

  try {
    const response = await fetch(url, config);

    if (!response.ok) {
      // 401 自动登出并跳转登录页
      if (response.status === 401 && !skipAuth) {
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined' && window.location.pathname !== '/auth') {
          window.location.href = '/auth';
        }
      }
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
    }

    const data = await response.json();
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`请求超时 [${endpoint}] (${timeout}ms)`, { cause: error });
    }
    if (error instanceof Error) {
      console.error(`请求失败 [${endpoint}]:`, error.message);
      throw error;
    }
    throw new Error('未知请求错误', { cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function get<T>(endpoint: string, params?: Record<string, string>, timeout?: number): Promise<T> {
  return http<T>(endpoint, { method: 'GET', params, timeout });
}

/**
 * 解析 http() 抛出的错误，提取状态码与后端返回的 error 文案。
 *
 * http() 在非 2xx 时抛 `new Error(`HTTP ${status}: ${body}`)`，body 通常是
 * 后端 WriteJSONError 写入的 `{"success":false,"error":"msg"}` JSON。
 * 本 helper 解析出 status 与人类可读 message（解析失败时退化为原始 body）。
 *
 * 非 http 错误（如网络中断、超时）返回 null。
 */
export interface ParsedHttpError {
  status: number;
  body: string;
  message: string;
}

export function parseHttpError(err: unknown): ParsedHttpError | null {
  if (!(err instanceof Error)) return null;
  const m = err.message.match(/^HTTP (\d+): ([\s\S]*)$/);
  if (!m) return null;
  const status = Number(m[1]);
  const body = m[2];
  let message = body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const errField = (parsed as { error: unknown }).error;
      if (typeof errField === 'string') {
        message = errField;
      }
    }
  } catch {
    // body 不是 JSON，保持原样
  }
  return { status, body, message };
}

export function post<T>(endpoint: string, body?: unknown): Promise<T> {
  return http<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function put<T>(endpoint: string, body?: unknown): Promise<T> {
  return http<T>(endpoint, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function del<T>(endpoint: string): Promise<T> {
  return http<T>(endpoint, { method: 'DELETE' });
}