import { backup, DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const live = join(process.env.DATA_DIR || 'data', 'fitness.sqlite');
if (process.argv[2] === 'restore') {
  const folder = await mkdtemp(join(process.env.DATA_DIR || 'data', 'restore-'));
  const incoming = join(folder, 'backup.sqlite');
  try {
    await pipeline(process.stdin, createWriteStream(incoming));
    const db = new DatabaseSync(incoming);
    try {
      const result = db.prepare('PRAGMA quick_check').get();
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(item => item.name);
      if (result.quick_check !== 'ok' || !['workouts','sets','preferences','reminders'].every(table => tables.includes(table))) {
        throw new Error('The backup did not pass validation.');
      }
      db.exec('PRAGMA journal_mode=DELETE');
    } finally { db.close(); }
    const current = new DatabaseSync(live);
    try { current.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE'); } finally { current.close(); }
    await rename(incoming, live);
    console.error('Restored fitness.sqlite.');
  } finally { await rm(folder, { recursive: true, force: true }); }
} else {
  const folder = await mkdtemp(join(tmpdir(), 'form-backup-'));
  const target = join(folder, 'backup.sqlite');
  const db = new DatabaseSync(live, { readOnly: true });
  try {
    await backup(db, target);
    await pipeline(createReadStream(target), process.stdout);
  } finally { db.close(); await rm(folder, { recursive: true, force: true }); }
}
