import { describe, it, expect } from 'vitest';
import { setPathValue } from '@/store/onlineGameStore/sync';

describe('setPathValue', () => {
  it('should set a simple top-level property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'name', 'test');
    expect(obj.name).toBe('test');
  });

  it('should set a nested property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'user.name', 'Alice');
    expect((obj.user as Record<string, unknown>).name).toBe('Alice');
  });

  it('should set deeply nested properties', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'a.b.c.d', 42);
    expect(((obj.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<string, unknown>).toHaveProperty('d', 42);
  });

  it('should set array index property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'items[0].name', 'first');
    expect(Array.isArray(obj.items)).toBe(true);
    expect((obj.items as Record<string, unknown>[])[0].name).toBe('first');
  });

  it('should set array index with nested property', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'players[0].name', 'Alice');
    expect(Array.isArray(obj.players)).toBe(true);
    expect((obj.players as Record<string, unknown>[])[0].name).toBe('Alice');
  });

  it('should set multiple array items', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'items[0].id', 1);
    setPathValue(obj, 'items[1].id', 2);
    expect((obj.items as Record<string, unknown>[]).length).toBeGreaterThanOrEqual(2);
    expect((obj.items as Record<string, unknown>[])[0].id).toBe(1);
    expect((obj.items as Record<string, unknown>[])[1].id).toBe(2);
  });

  it('should overwrite existing values', () => {
    const obj: Record<string, unknown> = { name: 'old' };
    setPathValue(obj, 'name', 'new');
    expect(obj.name).toBe('new');
  });

  it('should preserve existing sibling properties', () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    setPathValue(obj, 'c', 3);
    expect(obj.a).toBe(1);
    expect(obj.b).toBe(2);
    expect(obj.c).toBe(3);
  });

  it('should handle null values', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'value', null);
    expect(obj.value).toBeNull();
  });

  it('should handle false boolean values', () => {
    const obj: Record<string, unknown> = {};
    setPathValue(obj, 'active', false);
    expect(obj.active).toBe(false);
  });
});
