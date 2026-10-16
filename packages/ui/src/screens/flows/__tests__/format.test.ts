import { clockMs, fmtPerMin } from '../format';

describe('fmtPerMin', () => {
  it('keeps one decimal under 100 and marks tiny rates', () => {
    expect(fmtPerMin(6.4)).toBe('6.4/min');
    expect(fmtPerMin(12)).toBe('12/min');
    expect(fmtPerMin(0)).toBe('0/min');
    expect(fmtPerMin(0.04)).toBe('<0.1/min');
    expect(fmtPerMin(128.4)).toBe('128/min');
    expect(fmtPerMin(null)).toBe('—');
  });
});

describe('clockMs', () => {
  it('formats local time with tenths', () => {
    const ms = new Date(2026, 9, 15, 13, 2, 11, 470).getTime();
    expect(clockMs(ms)).toBe('13:02:11.4');
    expect(clockMs(null)).toBe('—');
  });
});
