/**
 * Unit tests for the app's pure helpers (no browser, no chain).
 * Run: bun run test:unit
 */

import { describe, expect, test } from 'bun:test';
import { formatNaira, formatUsdc, nairaToUsdc, USDC_TO_NGN } from '../src/lib/naira';
import { LANGUAGES, LAGOS_AREAS, PROPERTY_TYPES, TRANSLATIONS } from '../src/lib/i18n';
import { EscrowStatus } from '../src/lib/contracts';
import { formatAmount, parseAmount, parseUsdc } from '../src/onchain-money';
import { HOURS, calendarLink, formatSlot, lagosMs, nextDays, prettyPhone } from '../src/lib/inspections';
import { scamHint } from '../src/lib/chat';

describe('naira', () => {
  test('converts at the fixed rate both ways', () => {
    expect(nairaToUsdc(USDC_TO_NGN * 500)).toBe(500);
    expect(formatNaira(500)).toContain('800,000');
    expect(formatNaira(500)).toContain('₦');
  });
  test('bad input shows ₦0 instead of NaN', () => {
    expect(formatNaira('abc')).toBe('₦0');
  });
  test('USDC shows two decimals', () => {
    expect(formatUsdc(12.5)).toBe('12.50 USDC');
  });
});

describe('translations', () => {
  test('every language has every English key, none empty', () => {
    const keys = Object.keys(TRANSLATIONS.en);
    for (const { code } of LANGUAGES) {
      const missing = keys.filter(k => !(TRANSLATIONS[code] as Record<string, string>)[k]?.trim());
      expect({ code, missing }).toEqual({ code, missing: [] });
    }
  });
  test('Lagos areas and property types are populated', () => {
    expect(LAGOS_AREAS.length).toBeGreaterThan(20);
    expect(PROPERTY_TYPES).toContain('two_bed');
  });
});

describe('contract enums match RentFlowEscrow.sol', () => {
  test('EscrowStatus order', () => {
    expect([EscrowStatus.Pending, EscrowStatus.Active, EscrowStatus.Released, EscrowStatus.Refunded, EscrowStatus.Disputed, EscrowStatus.Ending])
      .toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('USDC amounts', () => {
  test('parse and format round-trip on Arc (6 decimals)', () => {
    const a = parseAmount(5042002, '512.5');
    expect(a.raw).toBe(512_500_000n);
    expect(formatAmount(5042002, a)).toContain('512.5');
    expect(parseUsdc('0')).toBe(0n);
  });
  test('silently truncates beyond USDC decimals (viem parseUnits behaviour)', () => {
    // viem's parseUnits truncates extra fractional digits rather than throwing.
    // 1.0000001 with 6 decimals → 1_000_000n (the trailing 1 is below 1 micro-USDC).
    const result = parseAmount(5042002, '1.0000001');
    expect(result.raw).toBe(1_000_000n);
  });
});

describe('inspection time slots (Lagos time, UTC+1)', () => {
  test('10am Lagos is 9am UTC', () => {
    expect(new Date(lagosMs(2026, 9, 7, 10)).toISOString()).toBe('2026-10-07T09:00:00.000Z');
  });
  test('the next days start today in Lagos, even just after midnight', () => {
    const justAfterMidnightLagos = lagosMs(2026, 9, 7, 0, 30);
    const days = nextDays(3, justAfterMidnightLagos);
    expect(days.map(d => d.d)).toEqual([7, 8, 9]);
    expect(days[0].label).toBe('Today');
    expect(days[1].label).toBe('Tomorrow');
  });
  test('slots read naturally', () => {
    const now = lagosMs(2026, 9, 7, 8);
    expect(formatSlot(lagosMs(2026, 9, 7, 14), now)).toMatch(/^Today, 2:00\s?pm$/i);
    expect(formatSlot(lagosMs(2026, 9, 8, 10), now)).toMatch(/^Tomorrow, 10:00\s?am$/i);
  });
  test('visiting hours are 8am–6pm', () => {
    expect([HOURS[0], HOURS[HOURS.length - 1]]).toEqual([8, 18]);
  });
  test('calendar link is a one-hour Google Calendar event', () => {
    const url = new URL(calendarLink('Inspection', lagosMs(2026, 9, 7, 10), 'Yaba'));
    expect(url.searchParams.get('dates')).toBe('20261007T090000Z/20261007T100000Z');
  });
  test('Nigerian numbers are shown the local way', () => {
    expect(prettyPhone('2348031234567')).toBe('0803 123 4567');
  });
});

describe('chat scam warnings', () => {
  test('flags bank details', () => {
    expect(scamHint('Pay to 0123456789 GTB to hold it')).toContain('bank details');
    expect(scamHint('Opay: 8031234567, name Ade')).toContain('bank details');
  });
  test('flags pay-to-view', () => {
    expect(scamHint('There is an inspection fee of 5k')).toContain('Never pay to view');
    expect(scamHint('Transfer the deposit to secure it')).toContain('Never pay to view');
  });
  test('leaves normal messages alone', () => {
    expect(scamHint('Yes, Saturday 10am works. The rent is ₦800,000 a year.')).toBeNull();
    expect(scamHint('My number is 08031234567, call when you arrive')).toBeNull();
  });
});
