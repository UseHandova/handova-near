import { expect, test } from 'bun:test';
import { cleanResult } from './inspect';

test("an inspection answer is kept within the rules, whatever the model returns", () => {
  const r = cleanResult({ issues: [{ area: 'door', issue: 'broken hinge', severity: 'catastrophic' as any }], suggestedDeductionPercent: 180, confidence: 'certain' as any, summary: 'x'.repeat(900) });
  expect(r.suggestedDeductionPercent).toBe(100);
  expect(r.issues[0].severity).toBe('minor');
  expect(r.confidence).toBe('low');
  expect(r.summary.length).toBe(500);
  expect(cleanResult({ suggestedDeductionPercent: -5 }).suggestedDeductionPercent).toBe(0);
  expect(cleanResult({}).issues).toEqual([]);
});
