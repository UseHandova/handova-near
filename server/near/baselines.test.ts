import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baselineFor, rememberBaseline } from './baselines';

test("the first listing seen for a lease stays the inspection's before photos", () => {
  const dir = mkdtempSync(join(tmpdir(), 'baselines-'));
  const file = join(dir, 'b.json');
  try {
    expect(baselineFor(file, 7, '{"p":["/edited.jpg"]}').source).toBe('current');
    rememberBaseline(file, 7, '{"p":["/original.jpg"]}', 1000);
    rememberBaseline(file, 7, '{"p":["/edited.jpg"]}', 2000); // the landlord edited the listing later
    const b = baselineFor(file, 7, '{"p":["/edited.jpg"]}');
    expect(b.propertyRef).toBe('{"p":["/original.jpg"]}');
    expect(b.source).toBe('snapshot');
    expect(b.capturedAt).toBe(1000);
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
