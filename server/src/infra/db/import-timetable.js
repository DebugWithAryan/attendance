/**
 * Loads a class routine file into a database.
 *
 *   DATABASE_URL=... npm run timetable:import                       # the D2 BBA routine
 *   DATABASE_URL=... npm run timetable:import -- path/to/routine.json
 *   DATABASE_URL=... npm run timetable:import -- path/to/routine.json --dry-run
 *
 * The course, section and subjects are created if they do not exist, the
 * section's week is made to match the file, and the course's days, periods
 * and printed timings are set. A teacher the database does not know yet gets
 * an account with a one-time password, printed once at the end: hand it over
 * in person, as with any account in this system.
 *
 * A class the routine lists without a teacher is left out and named at the
 * end, so the HOD can allocate it from Schedule once they know who takes it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './pool.js';
import { importRoutine } from './timetable.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--'))
  || join(dirname(fileURLToPath(import.meta.url)), 'timetables', 'd2-bba.json');

async function run() {
  const routine = JSON.parse(readFileSync(file, 'utf8'));

  // The import is recorded against a real person: the HOD, or failing that an administrator.
  const actor = (await pool.query(
    `select id, name, role from users where role in ('hod', 'admin') and status = 'active'
      order by case role when 'hod' then 0 else 1 end, created_at limit 1`,
  )).rows[0];
  if (!actor) throw new Error('Create the HOD or administrator account first: the import is recorded against it.');

  let report;
  try {
    await withTransaction(async (tx) => {
      report = await importRoutine(tx, routine, { createdBy: actor.id });
      if (dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
    });
  } catch (err) {
    if (!err.dryRun) throw err;
  }

  const s = report.slots;
  console.log(`${dryRun ? '[dry run, nothing saved] ' : ''}${routine.title || file}
  into ${report.course} · ${report.section}: ${routine.daysPerWeek ?? 6} days of ${routine.periodsPerDay ?? 8} periods, recorded against ${actor.name} (${actor.role})
  course ${report.created.course ? 'created' : 'already there'}, section ${report.created.section ? 'created' : 'already there'}${report.created.subjects.length ? `, subjects added: ${report.created.subjects.join(', ')}` : ''}
  timetable: ${s.added} added, ${s.changed} changed, ${s.unchanged} already right, ${s.cleared} cleared`);

  if (report.unassigned.length) {
    console.log('\nNo teacher on the routine, so left for the HOD to allocate from Schedule:');
    for (const u of report.unassigned) console.log(`  ${u.day} period ${u.period}: ${u.subject}`);
  }
  if (report.created.teachers.length) {
    console.log(`\nNew teacher accounts${dryRun ? ' (not created: dry run)' : ''}. Hand each password over in person and ask them to change it:`);
    for (const t of report.created.teachers) console.log(`  ${t.name.padEnd(6)} ${t.loginId.padEnd(18)} ${t.password ?? ''}`);
  }
}

run()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
