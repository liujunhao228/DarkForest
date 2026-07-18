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

export function get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  return http<T>(endpoint, { method: 'GET', params });
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