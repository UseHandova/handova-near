/**
 * Backups: consistent snapshot of a live database, encrypted, restorable, pruned after 14 days.
 * Run: bun test server/backup.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupNow, listBackups, openBackup, prune, type BackupConfig } from './backup';

const dir = mkdtempSync(join(tmpdir(), 'backup-'));
const dbFile = join(dir, 'rentflow.db');
const verifications = join(dir, 'verifications.json');
const key = Buffer.alloc(32, 9);

const live = new Database(dbFile, { create: true });
live.exec("PRAGMA journal_mode = WAL; CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO messages (body) VALUES ('Is the flat still available?'), ('Yes, come on Saturday');");
writeFileSync(verifications, JSON.stringify({ ninHashes: { abc: '0x1' } }));
const cfg: BackupConfig = { dbFile, extraFiles: [verifications], dir: join(dir, 'backups'), key, bucket: null };

describe('backups', () => {
  test('snapshot of a database that is open and in use', async () => {
    const path = await backupNow(cfg, new Date('2026-10-07T23:15:00Z'));
    expect(path.endsWith('handova-20261007T231500Z.backup')).toBe(true);
    expect(listBackups(cfg)).toHaveLength(1);
  });
  test('the file is encrypted: no readable chat text inside', () => {
    const raw = readFileSync(listBackups(cfg)[0].path);
    expect(raw.includes(Buffer.from('still available'))).toBe(false);
    expect(raw.includes(Buffer.from('SQLite format'))).toBe(false);
  });
  test('restores to a working database with the identity fingerprints', () => {
    const files = openBackup(key, readFileSync(listBackups(cfg)[0].path));
    const out = join(dir, 'restored.db');
    writeFileSync(out, files['rentflow.db']);
    const db = new Database(out, { readonly: true });
    expect((db.query('SELECT body FROM messages ORDER BY id').all() as { body: string }[]).map(r => r.body)).toEqual(['Is the flat still available?', 'Yes, come on Saturday']);
    expect(JSON.parse(files['verifications.json'].toString()).ninHashes.abc).toBe('0x1');
  });
  test('the wrong key cannot open it', () => {
    expect(() => openBackup(Buffer.alloc(32, 1), readFileSync(listBackups(cfg)[0].path))).toThrow('Wrong backup key');
  });
  test('backups older than 14 days are deleted', async () => {
    await backupNow(cfg, new Date('2026-10-20T23:15:00Z'));
    expect(listBackups(cfg)).toHaveLength(2);
    prune(cfg, Date.parse('2026-10-22T00:00:00Z')); // first one is now 14+ days old
    const left = listBackups(cfg);
    expect(left).toHaveLength(1);
    expect(left[0].path).toContain('20261020');
    expect(existsSync(join(cfg.dir, 'handova-20261007T231500Z.backup'))).toBe(false);
  });
});
