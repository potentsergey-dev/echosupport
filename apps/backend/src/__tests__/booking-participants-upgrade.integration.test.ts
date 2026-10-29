import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { expect, it } from 'vitest';

it('upgrades old rows, quarantines ambiguous counts and preserves old revision writes', async () => {
  const db = await new PrismaPg({
    connectionString: process.env['TEST_DATABASE_URL']!,
    max: 1,
  }).connect();
  try {
    const fixture = await readFile(
      new URL('./fixtures/booking-participants-upgrade.sql', import.meta.url),
      'utf8',
    );
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20261029160000_booking_participant_count/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await expect(
      db
        .underlyingDriver()
        .query(
          fixture.replace('-- MIGRATION_HERE', () =>
            migration.replace(/^BEGIN;\r?\n/, '').replace(/\r?\nCOMMIT;\s*$/, ''),
          ),
        ),
    ).resolves.toBeDefined();
  } finally {
    await db.dispose();
  }
});

it('rolls back the entire expand migration if a later step fails', async () => {
  const db = await new PrismaPg({
    connectionString: process.env['TEST_DATABASE_URL']!,
    max: 1,
  }).connect();
  const pool = db.underlyingDriver();
  try {
    const fixture = await readFile(
      new URL('./fixtures/booking-participants-upgrade.sql', import.meta.url),
      'utf8',
    );
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20261029160000_booking_participant_count/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const prepare = fixture
      .split('-- MIGRATION_HERE')[0]!
      .replace(/^BEGIN;\r?\n/, '')
      .replace('SET LOCAL search_path', 'SET search_path');
    await pool.query(prepare);
    const failing = migration.replace(
      /COMMIT;\s*$/,
      () => "DO $$ BEGIN RAISE EXCEPTION 'synthetic migration failure'; END $$; COMMIT;",
    );
    await expect(pool.query(failing)).rejects.toThrow('synthetic migration failure');
    await pool.query('ROLLBACK');
    const columns = await pool.query<{ expanded: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='r02_upgrade_test' AND table_name='Appointment' AND column_name='participantCount') AS expanded`,
    );
    expect(columns.rows[0]!.expanded).toBe(false);
    const original = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM "r02_upgrade_test"."Appointment"',
    );
    expect(Number(original.rows[0]!.count)).toBe(7);
  } finally {
    await pool.query('ROLLBACK; RESET search_path; DROP SCHEMA IF EXISTS r02_upgrade_test CASCADE');
    await db.dispose();
  }
});
