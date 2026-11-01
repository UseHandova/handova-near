/**
 * E2E tests for the new Shop/Commercial listing types and
 * Landlord Preferences/Exemptions feature.
 *
 * Pure-logic / data-layer tests — no browser, no chain, no server needed.
 * Run: bun test tests/e2e-new-features.test.ts
 */

import { describe, expect, test } from 'bun:test';
import {
  PROPERTY_TYPES,
  RESIDENTIAL_TYPES,
  COMMERCIAL_TYPES,
  TRANSLATIONS,
  LANGUAGES,
  type PropertyType,
} from '../src/lib/i18n';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Commercial property types exported correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('commercial property types', () => {
  const EXPECTED_COMMERCIAL: PropertyType[] = [
    'open_shop', 'shop_office', 'warehouse', 'commercial_space',
  ];

  test('all commercial types exist in COMMERCIAL_TYPES', () => {
    for (const t of EXPECTED_COMMERCIAL) {
      expect(COMMERCIAL_TYPES).toContain(t);
    }
  });

  test('commercial types are NOT in RESIDENTIAL_TYPES', () => {
    for (const t of EXPECTED_COMMERCIAL) {
      expect(RESIDENTIAL_TYPES).not.toContain(t);
    }
  });

  test('all commercial types exist in the master PROPERTY_TYPES list', () => {
    for (const t of EXPECTED_COMMERCIAL) {
      expect(PROPERTY_TYPES).toContain(t);
    }
  });

  test('core residential types are in RESIDENTIAL_TYPES', () => {
    const CORE: PropertyType[] = ['self_contain', 'two_bed', 'three_bed', 'duplex', 'bungalow'];
    for (const t of CORE) {
      expect(RESIDENTIAL_TYPES).toContain(t);
      expect(COMMERCIAL_TYPES).not.toContain(t);
    }
  });

  test('no duplicate types across residential + commercial', () => {
    const overlap = RESIDENTIAL_TYPES.filter(t => (COMMERCIAL_TYPES as readonly string[]).includes(t));
    expect(overlap).toEqual([]);
  });

  test('RESIDENTIAL_TYPES + COMMERCIAL_TYPES covers all PROPERTY_TYPES', () => {
    const combined = new Set([...RESIDENTIAL_TYPES, ...COMMERCIAL_TYPES]);
    for (const t of PROPERTY_TYPES) {
      expect(combined.has(t)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Commercial type translations (keys: open_shop, shop_office, etc.)
// ─────────────────────────────────────────────────────────────────────────────

describe('commercial type translations', () => {
  const COMMERCIAL_TRANS_KEYS = [
    'open_shop', 'shop_office', 'warehouse', 'commercial_space',
  ] as const;

  for (const { code } of LANGUAGES) {
    test(`${code.toUpperCase()}: all commercial type keys are translated`, () => {
      const dict = TRANSLATIONS[code] as Record<string, string>;
      const missing: string[] = [];
      for (const key of COMMERCIAL_TRANS_KEYS) {
        if (!dict[key]?.trim()) missing.push(key);
      }
      expect({ code, missing }).toEqual({ code, missing: [] });
    });
  }

  test('English commercial labels are human-readable (no underscores)', () => {
    const dict = TRANSLATIONS.en as Record<string, string>;
    for (const key of COMMERCIAL_TRANS_KEYS) {
      expect(dict[key]).not.toContain('_');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Landlord preferences / exemptions translations
// ─────────────────────────────────────────────────────────────────────────────

describe('landlord preferences translations', () => {
  // These are the actual key names used in i18n.ts
  const PREF_KEYS = [
    'preferences_label',
    'preferences_placeholder',
    'no_couples', 'no_children', 'no_pets', 'no_students', 'no_smoking',
    'professionals_only', 'females_only', 'males_only',
    'preferences_notice',
    'tenant_preferences',
  ] as const;

  for (const { code } of LANGUAGES) {
    test(`${code.toUpperCase()}: all preference keys are translated`, () => {
      const dict = TRANSLATIONS[code] as Record<string, string>;
      const missing: string[] = [];
      for (const key of PREF_KEYS) {
        if (!dict[key]?.trim()) missing.push(key);
      }
      expect({ code, missing }).toEqual({ code, missing: [] });
    });
  }

  test('English preference tag labels start with a capital letter', () => {
    const dict = TRANSLATIONS.en as Record<string, string>;
    const tagKeys = [
      'no_couples', 'no_children', 'no_pets', 'no_students',
      'no_smoking', 'professionals_only', 'females_only', 'males_only',
    ] as const;
    for (const key of tagKeys) {
      const val = dict[key];
      expect(val[0]).toBe(val[0].toUpperCase());
    }
  });

  test('preferences_notice contains a meaningful message in English', () => {
    const notice = (TRANSLATIONS.en as Record<string, string>)['preferences_notice'];
    expect(notice.length).toBeGreaterThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ListingMeta preferences field (structural check)
// ─────────────────────────────────────────────────────────────────────────────

describe('ListingMeta preferences field', () => {
  const buildMeta = (opts: { preferences?: string; preferenceTags?: string[] }) => ({
    address: '5 Awolowo Road, Ikoyi',
    propertyType: 'open_shop' as PropertyType,
    preferences: opts.preferences,
    preferenceTags: opts.preferenceTags,
  });

  test('meta with no preferences is valid (optional fields absent)', () => {
    const meta = buildMeta({});
    expect(meta.preferences).toBeUndefined();
    expect(meta.preferenceTags).toBeUndefined();
  });

  test('meta with tags is valid', () => {
    const meta = buildMeta({ preferenceTags: ['no_pets', 'professionals_only'] });
    expect(meta.preferenceTags).toHaveLength(2);
    expect(meta.preferenceTags).toContain('no_pets');
  });

  test('meta with free-text preferences is valid', () => {
    const meta = buildMeta({ preferences: 'No noise after 10pm, working class only' });
    expect(meta.preferences!.length).toBeGreaterThan(5);
  });

  test('commercial property type is stored correctly in meta', () => {
    const meta = buildMeta({});
    expect(COMMERCIAL_TYPES).toContain(meta.propertyType);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. BrowseListings filter logic (pure function simulation)
// ─────────────────────────────────────────────────────────────────────────────

describe('listing category filter logic', () => {
  type MockListing = { propertyType: string };

  const applyFilter = (
    listings: MockListing[],
    category: 'all' | 'residential' | 'commercial',
  ) => {
    if (category === 'all') return listings;
    const set: Set<string> = category === 'commercial'
      ? new Set(COMMERCIAL_TYPES)
      : new Set(RESIDENTIAL_TYPES);
    return listings.filter(l => set.has(l.propertyType));
  };

  // Use actual type values from the constants
  const mockListings: MockListing[] = [
    { propertyType: 'self_contain' },    // residential
    { propertyType: 'two_bed' },         // residential
    { propertyType: 'duplex' },          // residential
    { propertyType: 'open_shop' },       // commercial
    { propertyType: 'warehouse' },       // commercial
    { propertyType: 'commercial_space' },// commercial
  ];

  test('"all" returns every listing', () => {
    expect(applyFilter(mockListings, 'all')).toHaveLength(6);
  });

  test('"residential" returns only residential types', () => {
    const result = applyFilter(mockListings, 'residential');
    expect(result).toHaveLength(3);
    for (const l of result) {
      expect(RESIDENTIAL_TYPES).toContain(l.propertyType);
    }
  });

  test('"commercial" returns only commercial types', () => {
    const result = applyFilter(mockListings, 'commercial');
    expect(result).toHaveLength(3);
    for (const l of result) {
      expect(COMMERCIAL_TYPES).toContain(l.propertyType);
    }
  });

  test('an unrecognised type is excluded from both residential and commercial', () => {
    const strange: MockListing[] = [{ propertyType: 'mystery_type' }];
    expect(applyFilter(strange, 'residential')).toHaveLength(0);
    expect(applyFilter(strange, 'commercial')).toHaveLength(0);
    expect(applyFilter(strange, 'all')).toHaveLength(1);
  });

  test('filtering is case-sensitive (no accidental matches)', () => {
    const upper: MockListing[] = [{ propertyType: 'OPEN_SHOP' }];
    expect(applyFilter(upper, 'commercial')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Preference tag round-trip (tag id → translation → display)
// ─────────────────────────────────────────────────────────────────────────────

describe('preference tag display', () => {
  const TAGS = [
    'no_couples', 'no_children', 'no_pets', 'no_students',
    'no_smoking', 'professionals_only', 'females_only', 'males_only',
  ] as const;

  test('every quick-pick tag has a non-empty English translation', () => {
    const enDict = TRANSLATIONS.en as Record<string, string>;
    for (const tag of TAGS) {
      expect(enDict[tag]?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  test('tags translate correctly in Yoruba', () => {
    const dict = TRANSLATIONS.yo as Record<string, string>;
    const missing = TAGS.filter(t => !dict[t]?.trim());
    expect(missing).toEqual([]);
  });

  test('tags translate correctly in Pidgin', () => {
    const dict = TRANSLATIONS.pcm as Record<string, string>;
    const missing = TAGS.filter(t => !dict[t]?.trim());
    expect(missing).toEqual([]);
  });

  test('tags translate correctly in Igbo', () => {
    const dict = TRANSLATIONS.ig as Record<string, string>;
    const missing = TAGS.filter(t => !dict[t]?.trim());
    expect(missing).toEqual([]);
  });

  test('tags translate correctly in Hausa', () => {
    const dict = TRANSLATIONS.ha as Record<string, string>;
    const missing = TAGS.filter(t => !dict[t]?.trim());
    expect(missing).toEqual([]);
  });
});
