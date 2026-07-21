import * as React from "react"

/**
 * 断点定义（与 Tailwind v4 默认断点一致）。
 * xs 为自定义小屏断点（< 640px），覆盖 iPhone SE 等小屏设备。
 */
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const BREAKPOINTS: ReadonlyArray<{ name: Breakpoint; min: number }> = [
  { name: 'xs', min: 0 },
  { name: 'sm', min: 640 },
  { name: 'md', min: 768 },
  { name: 'lg', min: 1024 },
  { name: 'xl', min: 1280 },
]

const MOBILE_BREAKPOINT = 768

/**
 * 根据 window.innerWidth 返回当前断点。
 * 在 SSR 或无 window 环境下返回 'lg'（桌面默认，避免首帧渲染移动端布局造成桌面闪烁）。
 */
function getBreakpointFromWidth(width: number): Breakpoint {
  for (let i = BREAKPOINTS.length - 1; i >= 0; i--) {
    if (width >= BREAKPOINTS[i].min) return BREAKPOINTS[i].name
  }
  return 'xs'
}

function getViewportWidth(): number {
  if (typeof window === 'undefined') return 1280
  return window.innerWidth
}

function getIsMobile(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

// ---- 模块级外部 store：订阅 resize 事件，所有 hook 共享 ----

const listeners = new Set<() => void>()
let cachedWidth = getViewportWidth()
let cachedIsMobile = getIsMobile()
let cachedBreakpoint = getBreakpointFromWidth(cachedWidth)
let initialized = false

function notifyAll(): void {
  for (const cb of listeners) cb()
}

function ensureInit(): void {
  if (initialized) return
  initialized = true
  if (typeof window === 'undefined') return
  const handleChange = () => {
    const nextWidth = window.innerWidth
    const nextIsMobile = nextWidth < MOBILE_BREAKPOINT
    const nextBreakpoint = getBreakpointFromWidth(nextWidth)
    if (
      nextWidth !== cachedWidth ||
      nextIsMobile !== cachedIsMobile ||
      nextBreakpoint !== cachedBreakpoint
    ) {
      cachedWidth = nextWidth
      cachedIsMobile = nextIsMobile
      cachedBreakpoint = nextBreakpoint
      notifyAll()
    }
  }
  window.addEventListener('resize', handleChange, { passive: true })
  // matchMedia 兜底（某些浏览器 resize 节流不同步）
  if (window.matchMedia) {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener('change', handleChange)
  }
}

function subscribe(cb: () => void): () => void {
  ensureInit()
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshotIsMobile(): boolean {
  ensureInit()
  return cachedIsMobile
}

function getSnapshotBreakpoint(): Breakpoint {
  ensureInit()
  return cachedBreakpoint
}

function getSnapshotWidth(): number {
  ensureInit()
  return cachedWidth
}

// SSR 快照：默认桌面布局，避免水合不匹配
function getServerSnapshotIsMobile(): boolean {
  return false
}

function getServerSnapshotBreakpoint(): Breakpoint {
  return 'lg'
}

function getServerSnapshotWidth(): number {
  return 1280
}

/**
 * 是否为移动端（width < 768px）。
 * 使用 useSyncExternalStore 订阅 resize，首帧直接返回真实值，避免闪烁。
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    getSnapshotIsMobile,
    getServerSnapshotIsMobile,
  )
}

/**
 * 当前断点（'xs' | 'sm' | 'md' | 'lg' | 'xl'）。
 * xs < 640, sm 640-767, md 768-1023, lg 1024-1279, xl >= 1280
 */
export function useBreakpoint(): Breakpoint {
  return React.useSyncExternalStore(
    subscribe,
    getSnapshotBreakpoint,
    getServerSnapshotBreakpoint,
  )
}

/**
 * 当前视口宽度（像素）。供需要精确数值的组件使用。
 */
export function useViewportWidth(): number {
  return React.useSyncExternalStore(
    subscribe,
    getSnapshotWidth,
    getServerSnapshotWidth,
  )
}

/**
 * 是否为平板（768 <= width < 1024）。
 */
export function useIsTablet(): boolean {
  const bp = useBreakpoint()
  return bp === 'md'
}

/**
 * 是否为桌面端（width >= 1024）。
 */
export function useIsDesktop(): boolean {
  const bp = useBreakpoint()
  return bp === 'lg' || bp === 'xl'
}
