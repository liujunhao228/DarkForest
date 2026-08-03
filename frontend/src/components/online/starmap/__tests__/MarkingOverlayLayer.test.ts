import { describe, it, expect } from 'vitest';
import { truncateToFirstLine } from '../utils';

describe('truncateToFirstLine', () => {
  it('空字符串返回空字符串', () => {
    expect(truncateToFirstLine('')).toBe('');
  });

  it('短单行原样返回', () => {
    expect(truncateToFirstLine('short')).toBe('short');
  });

  it('正好 12 字符原样返回', () => {
    expect(truncateToFirstLine('exactly12ch')).toBe('exactly12ch');
  });

  it('单行超过 12 字符截断为 12 + …', () => {
    // 13 字符：'too_long_text'
    expect(truncateToFirstLine('too_long_text')).toBe('too_long_tex…');
  });

  it('多行 note 取第一行（首行 ≤12 字符原样返回）', () => {
    expect(truncateToFirstLine('line1\nline2')).toBe('line1');
  });

  it('多行 note 首行超过 12 字符截断', () => {
    // 首行 'verylongline1' 共 13 字符
    expect(truncateToFirstLine('verylongline1\nline2')).toBe('verylongline…');
  });

  it('前导换行 split 后首行为空返回空字符串', () => {
    expect(truncateToFirstLine('\nabc')).toBe('');
  });
});
