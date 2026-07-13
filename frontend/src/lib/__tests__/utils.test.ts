import { describe, it, expect } from 'vitest';
import { cn, formatDuration, formatDate } from '@/lib/utils';

describe('cn', () => {
  it('should combine string class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should ignore falsy values', () => {
    expect(cn('foo', undefined, null, false, 'bar')).toBe('foo bar');
  });

  it('should handle conditional objects', () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe('foo baz');
  });

  it('should handle mixed inputs', () => {
    expect(cn('base', { active: true, disabled: false }, 'extra')).toBe('base active extra');
  });

  it('should return empty string for no arguments', () => {
    expect(cn()).toBe('');
  });
});

describe('formatDuration', () => {
  it('should format seconds less than 60', () => {
    expect(formatDuration(30)).toBe('0:30');
  });

  it('should format seconds with minutes', () => {
    expect(formatDuration(125)).toBe('2:05');
  });

  it('should pad single digit seconds', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  it('should handle zero seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('should handle 59 seconds', () => {
    expect(formatDuration(59)).toBe('0:59');
  });
});

describe('formatDate', () => {
  it('should format a timestamp to zh-CN locale', () => {
    const timestamp = new Date('2024-01-15T10:30:00').getTime();
    const result = formatDate(timestamp);
    expect(result).toContain('2024');
    expect(result).toContain('01');
    expect(result).toContain('15');
  });
});
