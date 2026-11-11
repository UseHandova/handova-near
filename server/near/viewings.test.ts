import { describe, expect, test } from 'bun:test';
import { canPay, normalisePhone, RULES, slotProblem } from './viewings';
import { issueToken, tokenAccount } from './auth';

const H = 3_600_000;
describe('viewings', () => {
  const base = { slotAt: 1_000 * H, tenantAgreedAt: null as number | null, landlordAgreedAt: null as number | null, updatedAt: 1_000 * H };
  test('only an agreed viewing, or a silent landlord after 24 h, lets the tenant pay', () => {
    expect(canPay({ ...base, status: 'approved' }, 1_001 * H)).toBe(false);
    expect(canPay({ ...base, status: 'agreed' }, 1_001 * H)).toBe(true);
    expect(canPay({ ...base, status: 'agreed' }, 1_000 * H + RULES.validMs + 1)).toBe(false);
    expect(canPay({ ...base, status: 'approved', tenantAgreedAt: 1_000 * H }, 1_023 * H)).toBe(false);
    expect(canPay({ ...base, status: 'approved', tenantAgreedAt: 1_000 * H }, 1_024 * H)).toBe(true);
    expect(canPay({ ...base, status: 'approved', landlordAgreedAt: 1_000 * H }, 2_000 * H)).toBe(false);
    expect(canPay({ ...base, status: 'requested' }, 2_000 * H)).toBe(false);
  });
  test('slot must be ahead and within 30 days', () => {
    const now = 1_000 * H;
    expect(slotProblem(NaN, now)).toMatch(/Pick a day/);
    expect(slotProblem(now - 2 * H, now)).toMatch(/Pick a time/);
    expect(slotProblem(now + 2 * H, now)).toBeNull();
    expect(slotProblem(now + 31 * 24 * H, now)).toMatch(/30 days/);
  });
  test('phones', () => {
    expect(normalisePhone('0803 123 4567')).toBe('2348031234567');
    expect(normalisePhone('+44 7700 900123')).toBe('447700900123');
    expect(normalisePhone('12')).toBe('');
  });
});
describe('auth tokens', () => {
  test('round trip, tamper and expiry', () => {
    const t = issueToken('ada.handova.testnet', 0);
    expect(tokenAccount(t, 1)).toBe('ada.handova.testnet');
    expect(tokenAccount(t.slice(0, -2) + 'xx', 1)).toBeNull();
    const [body, mac] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ a: 'evil.testnet', e: 9e15 })).toString('base64url');
    expect(tokenAccount(`${forged}.${mac}`, 1)).toBeNull();
    expect(body).toBeTruthy();
    expect(tokenAccount(t, 8 * 86_400_000)).toBeNull();
  });
});
