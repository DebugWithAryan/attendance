/**
 * A sample college for a public demonstration, such as a tech fest stall.
 *
 *   DATABASE_URL=... npm run seed:demo            # on a migrated, empty database
 *   DATABASE_URL=... npm run seed:demo -- --reset # wipe a demo database and start again
 *
 * Unlike seed.js, which exists for the test suites, this builds a college worth
 * looking at, around a real week: the D2 BBA class routine in
 * timetables/d2-bba.json, with its subjects, its teachers (by the initials the
 * routine uses), its period times and its break. Around that week it invents
 * the rest: thirty students, five weeks of registers already taken, a student
 * with the attendance badge and one below the minimum, a rain holiday that was
 * cancelled, a club event that credited attendance, the tech fest with its
 * afternoon class already called off, and requests waiting for someone to
 * decide them. Today's classes are left unmarked, so a teacher can take one live.
 *
 * Every account it creates is flagged as a demo account: none can have its
 * password changed or reset, or be removed. Set DEMO_MODE=1 on the deployment
 * to put one-tap sign-in buttons for them on the sign-in page.
 *
 * Never run it against a real college's database. It refuses a database that
 * already has accounts, and --reset only wipes one it seeded itself.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './pool.js';
import { hashPassword } from '../security/password.js';
import { importRoutine } from './timetable.js';
import { DEMO_PASSWORD } from '../../shared/demo.js';
import { addDays, isoDayOfWeek, todayIso } from '../../shared/dates.js';

const ROUTINE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'timetables', 'd2-bba.json'), 'utf8'));
const MARKER = 'demo_database';
const HISTORY_DAYS = 35;
const WORKING_DAYS = ROUTINE.daysPerWeek;
// The featured teacher is the class teacher, SS; everyone else is demo.<initials>.
const TEACHER_LOGINS = { SS: 'demo.teacher' };

// [name, login, how often they turn up]
const STUDENTS = [
  ['Ananya Das', 'demo.student', 0.97], ['Rohit Nair', 'demo.atrisk', 0.62], ['Aditya Kulkarni', 'demo.s03', 0.9],
  ['Meghna Reddy', 'demo.s04', 0.86], ['Farhan Qureshi', 'demo.s05', 0.93], ['Ishita Banerjee', 'demo.s06', 0.79],
  ['Karan Malhotra', 'demo.s07', 0.84], ['Lakshmi Pillai', 'demo.s08', 0.95], ['Nikhil Joshi', 'demo.s09', 0.74],
  ['Pooja Hegde', 'demo.s10', 0.89], ['Sameer Patil', 'demo.s11', 0.82], ['Tanvi Deshmukh', 'demo.s12', 0.92],
  ['Varun Chawla', 'demo.s13', 0.7], ['Zoya Siddiqui', 'demo.s14', 0.88], ['Aarav Menon', 'demo.s15', 0.91],
  ['Bhavya Shetty', 'demo.s16', 0.85], ['Chirag Agarwal', 'demo.s17', 0.77], ['Diya Krishnan', 'demo.s18', 0.96],
  ['Eshan Bose', 'demo.s19', 0.81], ['Gauri Kapoor', 'demo.s20', 0.9], ['Harsh Vardhan', 'demo.s21', 0.68],
  ['Jasleen Kaur', 'demo.s22', 0.94], ['Kabir Sethi', 'demo.s23', 0.83], ['Mira Iyengar', 'demo.s24', 0.87],
  ['Neel Choudhury', 'demo.s25', 0.75], ['Riya Fernandes', 'demo.s26', 0.93], ['Siddharth Rao', 'demo.s27', 0.8],
  ['Trisha Mukherjee', 'demo.s28', 0.89], ['Arnab Ghosh', 'demo.s29', 0.92], ['Sneha Chatterjee', 'demo.s30', 0.87],
];
const CLUB_MEMBERS = ['demo.student', 'demo.s05', 'demo.s09', 'demo.s17', 'demo.s23', 'demo.s26'];

/** The same "random" college every time, so screenshots and pitches match. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isClassDay = (date) => isoDayOfWeek(date) <= WORKING_DAYS;

/** Class days from `from` up to, not including, `to`. */
function classDays(from, to) {
  const days = [];
  for (let d = from; d < to; d = addDays(d, 1)) if (isClassDay(d)) days.push(d);
  return days;
}
/** The class day `skip` class days after `from` (0 = the next one). */
function nextClassDay(from, skip = 0) {
  let d = from;
  let found = -1;
  while (found < skip) { d = addDays(d, 1); if (isClassDay(d)) found += 1; }
  return d;
}
// Period p's start, from the routine's printed times (IST), stored in UTC.
const START_IST = ['10:15', '11:20', '12:25', '14:15'];
const periodTime = (date, period) => {
  const [h, m] = (START_IST[period - 1] || '09:00').split(':').map(Number);
  const minutes = h * 60 + m - 330; // IST is UTC+5:30
  return `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00Z`;
};

async function wipe() {
  const { rows } = await pool.query('select value from app_settings where key = $1', [MARKER]).catch(() => ({ rows: [] }));
  const { rows: [{ n }] } = await pool.query('select count(*)::int as n from users');
  if (!rows.length && n > 0) {
    throw new Error('Refusing to reset: this database was not created by seed:demo, and it has accounts in it.');
  }
  await pool.query(`truncate users, courses, sections, subjects, students, class_teacher_allocations,
    schedule_slots, attendance_criteria, app_settings, attendance_records, attendance_summary,
    leave_requests, clubs, club_members, events, event_credit_periods, event_join_requests,
    attendance_credits, notifications, activity_log, login_attempts, class_sessions restart identity cascade`);
  console.log('demo database wiped');
}

async function seed() {
  if (process.argv.includes('--reset')) await wipe();

  const { rows: [{ n }] } = await pool.query('select count(*)::int as n from users');
  if (n > 0) {
    throw new Error('This database already has accounts. Run seed:demo on an empty database, or pass --reset on a demo database.');
  }

  const today = todayIso();
  const joined = `${addDays(today, -60)}T04:00:00Z`;
  const password = await hashPassword(DEMO_PASSWORD);
  const random = prng(20260927);

  await withTransaction(async (tx) => {
    const user = async (name, loginId, role, extra = {}) => (await tx.query(
      `insert into users (name, login_id, password_hash, role, can_add_users, created_by, created_at, is_demo)
       values ($1,$2,$3,$4,$5,$6,$7,true) returning id, name, login_id`,
      [name, loginId, password, role, extra.canAddUsers ?? false, extra.createdBy ?? null, joined],
    )).rows[0];

    const admin = await user('Demo Administrator', 'demo.admin', 'admin');
    const hod = await user('Dr. Kavitha Rao', 'demo.hod', 'hod', { createdBy: admin.id });
    const mentor = await user('Vikram Singh', 'demo.mentor', 'mentor', { createdBy: hod.id });

    // ---- the week: the real D2 BBA routine ---------------------------------
    const imported = await importRoutine(tx, ROUTINE, {
      createdBy: hod.id,
      isDemo: true,
      password: DEMO_PASSWORD,
      loginFor: (initials) => TEACHER_LOGINS[initials] || `demo.${initials.toLowerCase()}`,
      // Wednesday's review class has no teacher on the routine; the HOD can reassign it.
      placeholder: { name: 'To be assigned', loginId: 'demo.tba' },
    });
    const courseId = imported.courseId;
    const sectionId = imported.sectionId;
    await tx.query(`update users set created_at = $1, can_add_users = (login_id = 'demo.teacher') where role = 'teacher'`, [joined]);
    await tx.query('insert into attendance_criteria (course_id, percentage, set_by) values ($1, 75, $2)', [courseId, hod.id]);

    const classTeacher = (await tx.query(`select id, name from users where login_id = 'demo.teacher'`)).rows[0];
    const placeholder = (await tx.query(`select id from users where login_id = 'demo.tba'`)).rows[0];
    await tx.query(
      `insert into class_teacher_allocations (section_id, course_id, teacher_id, assigned_by) values ($1,$2,$3,$4)`,
      [sectionId, courseId, classTeacher.id, hod.id],
    );

    const students = [];
    for (const [i, [name, loginId, turnout]] of STUDENTS.entries()) {
      const s = await user(name, loginId, 'student', { createdBy: hod.id });
      await tx.query(
        'insert into students (user_id, course_id, section_id, roll_number) values ($1,$2,$3,$4)',
        [s.id, courseId, sectionId, `D2-${String(i + 1).padStart(2, '0')}`],
      );
      students.push({ ...s, turnout });
    }
    const byLogin = new Map(students.map((s) => [s.login_id, s]));

    const grid = new Map((await tx.query(
      `select sl.id, sl.day_of_week, sl.period_number, sl.subject_id, sl.teacher_id, subj.name as subject_name, t.name as teacher_name
         from schedule_slots sl join subjects subj on subj.id = sl.subject_id join users t on t.id = sl.teacher_id
        where sl.section_id = $1`,
      [sectionId],
    )).rows.map((s) => [`${s.day_of_week}:${s.period_number}`, s]));

    // ---- the calendar ------------------------------------------------------
    const past = classDays(addDays(today, -HISTORY_DAYS), today);
    const rainDay = past[Math.floor(past.length * 0.45)];
    const contestDay = past[past.length - 7];
    const leaveDays = [past[past.length - 5], past[past.length - 4]];
    const challengeDay = nextClassDay(today, 1);
    const festDay = nextClassDay(today, 3);
    const karan = byLogin.get('demo.s07');

    // ---- clubs and events ---------------------------------------------------
    const club = (await tx.query(
      `insert into clubs (name, mentor_id, created_at) values ('Entrepreneurship Cell', $1, $2) returning id`,
      [mentor.id, `${addDays(today, -40)}T06:00:00Z`],
    )).rows[0];
    for (const loginId of CLUB_MEMBERS) {
      await tx.query('insert into club_members (club_id, student_id, added_by) values ($1,$2,$3)',
        [club.id, byLogin.get(loginId).id, mentor.id]);
    }
    const event = async (e) => {
      const row = (await tx.query(
        `insert into events (title, description, event_date, created_by, creator_role, club_id, visibility, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, title, event_date`,
        [e.title, e.description, e.date, e.by.id, e.role, e.clubId ?? null, e.visibility, e.createdAt],
      )).rows[0];
      for (const p of e.periods || []) await tx.query('insert into event_credit_periods (event_id, period_number) values ($1,$2)', [row.id, p]);
      return row;
    };
    const contest = await event({
      title: 'Inter-college B-Plan Contest', date: contestDay, by: mentor, role: 'mentor', clubId: club.id, visibility: 'members_only',
      description: 'The E-Cell team pitches its business plan at the regional round. Periods 3 and 4 are credited for the team.',
      periods: [3, 4], createdAt: `${addDays(contestDay, -6)}T06:00:00Z`,
    });
    const challenge = await event({
      title: 'Case Study Challenge', date: challengeDay, by: mentor, role: 'mentor', visibility: 'all_students',
      description: 'Crack a real company’s problem in teams of three. The 2:15 class is credited for participants.',
      periods: [4], createdAt: `${addDays(today, -2)}T06:00:00Z`,
    });
    const fest = await event({
      title: 'Tech Fest 2026', date: festDay, by: hod, role: 'hod', visibility: 'all_students',
      description: 'Stalls, talks and demos all afternoon. The class after the break is cancelled for everyone.',
      periods: [], createdAt: `${addDays(today, -3)}T06:00:00Z`,
    });

    // ---- five weeks of registers ------------------------------------------
    const records = [];
    const sessionRows = [];
    const credits = [];
    const activity = [];
    const rainBatch = randomUUID();
    const festBatch = randomUUID();

    for (const date of past) {
      const day = isoDayOfWeek(date);
      for (let period = 1; period <= ROUTINE.periodsPerDay; period += 1) {
        const slot = grid.get(`${day}:${period}`);
        if (!slot) continue;
        const base = {
          section_id: sectionId, course_id: courseId, subject_id: slot.subject_id, slot_id: slot.id,
          teacher_id: slot.teacher_id, class_date: date, period_number: period,
        };
        if (date === rainDay) {
          sessionRows.push({ ...base, status: 'cancelled', reason: 'College closed for heavy rain', batch_id: rainBatch, recorded_by: hod.id, created_at: `${addDays(date, -1)}T14:00:00Z` });
          continue;
        }
        // Nobody is assigned to the review class, so nobody took its register.
        if (slot.teacher_id === placeholder.id) continue;

        const at = periodTime(date, period);
        sessionRows.push({ ...base, status: 'held', recorded_by: slot.teacher_id, created_at: at });
        const tally = { present: 0, absent: 0, leave: 0 };
        for (const st of students) {
          let status = random() < st.turnout ? 'present' : 'absent';
          let source = 'teacher';
          let note = null;
          let markedBy = slot.teacher_id;
          if (st.id === karan.id && leaveDays.includes(date)) {
            status = 'leave'; source = 'leave_approval'; note = 'Marked as approved leave'; markedBy = classTeacher.id;
          }
          // A register or two was saved with someone left unmarked.
          if (st.login_id === 'demo.s13' && date === past[3] && period === 2) continue;
          if (st.login_id === 'demo.s25' && date === past[9] && period === 3) continue;
          if (date === contestDay && [3, 4].includes(period) && CLUB_MEMBERS.includes(st.login_id)) {
            const previous = status;
            credits.push({ student_id: st.id, period_number: period, previous_status: previous, was_override: previous === 'absent' });
            if (previous === 'absent') {
              status = 'present';
              source = 'event_credit';
              note = `Marked present — credited via "${contest.title}" by ${mentor.name}, overriding the teacher's original mark of absent`;
            }
          }
          tally[status] += 1;
          records.push({
            student_id: st.id, section_id: sectionId, subject_id: slot.subject_id, slot_id: slot.id,
            class_date: date, period_number: period, status, source, marked_by: markedBy,
            marked_at: at, override_note: note,
          });
        }
        activity.push({
          actor_id: slot.teacher_id, actor_role: 'teacher', action_type: 'attendance.saved', target_entity: 'section',
          target_id: sectionId, details: { class_date: date, period, subject: slot.subject_name, tally }, created_at: at,
        });
      }
    }

    // The fest: the class after the break is already called off.
    const festSlot = grid.get(`${isoDayOfWeek(festDay)}:4`);
    if (festSlot) {
      sessionRows.push({
        section_id: sectionId, course_id: courseId, subject_id: festSlot.subject_id, slot_id: festSlot.id,
        teacher_id: festSlot.teacher_id, class_date: festDay, period_number: 4, status: 'cancelled',
        reason: 'Tech Fest 2026 — no class after the break', batch_id: festBatch, event_id: fest.id,
        recorded_by: hod.id, created_at: `${addDays(today, -1)}T10:00:00Z`,
      });
    }

    await tx.query(
      `insert into class_sessions (section_id, course_id, subject_id, slot_id, teacher_id, class_date, period_number,
                                   status, reason, batch_id, event_id, recorded_by, created_at, updated_at)
       select section_id, course_id, subject_id, slot_id, teacher_id, class_date, period_number,
              status, reason, batch_id, event_id, recorded_by, created_at, created_at
         from jsonb_to_recordset($1::jsonb) as x(section_id uuid, course_id uuid, subject_id uuid, slot_id uuid,
              teacher_id uuid, class_date date, period_number smallint, status text, reason text, batch_id uuid,
              event_id uuid, recorded_by uuid, created_at timestamptz)`,
      [JSON.stringify(sessionRows)],
    );
    // One statement; the summary trigger keeps attendance_summary in step as the rows land.
    await tx.query(
      `insert into attendance_records (student_id, section_id, subject_id, slot_id, class_date, period_number,
                                       status, source, marked_by, marked_at, override_note, last_updated_by)
       select student_id, section_id, subject_id, slot_id, class_date, period_number,
              status, source, marked_by, marked_at, override_note, marked_by
         from jsonb_to_recordset($1::jsonb) as x(student_id uuid, section_id uuid, subject_id uuid, slot_id uuid,
              class_date date, period_number smallint, status text, source text, marked_by uuid,
              marked_at timestamptz, override_note text)`,
      [JSON.stringify(records)],
    );

    // The contest team was approved and credited.
    for (const loginId of CLUB_MEMBERS) {
      await tx.query(
        `insert into event_join_requests (event_id, student_id, status, decided_by, decided_at, created_at)
         values ($1,$2,'approved',$3,$4,$5)`,
        [contest.id, byLogin.get(loginId).id, mentor.id, `${contestDay}T12:00:00Z`, `${addDays(contestDay, -3)}T09:00:00Z`],
      );
    }
    for (const c of credits) {
      await tx.query(
        `insert into attendance_credits (event_id, student_id, period_number, attendance_record_id, previous_status, was_override, credited_by, created_at)
         select $1, $2, $3, r.id, $4, $5, $6, $7 from attendance_records r
          where r.student_id = $2 and r.class_date = $8 and r.period_number = $3`,
        [contest.id, c.student_id, c.period_number, c.previous_status, c.was_override, mentor.id, `${contestDay}T12:00:00Z`, contestDay],
      );
    }
    // Two students are waiting on the mentor for the case study challenge.
    for (const loginId of ['demo.s03', 'demo.s19']) {
      await tx.query('insert into event_join_requests (event_id, student_id, created_at) values ($1,$2,$3)',
        [challenge.id, byLogin.get(loginId).id, `${addDays(today, -1)}T08:00:00Z`]);
    }

    // ---- leave --------------------------------------------------------------
    await tx.query(
      `insert into leave_requests (student_id, from_date, to_date, reason, status, decided_by, decider_role, decided_at, decision_note, created_at)
       values ($1,$2,$3,$4,'approved',$5,'teacher',$6,'Certificate seen',$7)`,
      [karan.id, leaveDays[0], leaveDays[1], 'Viral fever, doctor advised two days of rest', classTeacher.id,
        `${addDays(leaveDays[0], -1)}T11:00:00Z`, `${addDays(leaveDays[0], -2)}T15:00:00Z`],
    );
    const nextDay = nextClassDay(today, 0);
    await tx.query(
      `insert into leave_requests (student_id, from_date, to_date, reason, created_at) values ($1,$2,$2,$3,$4)`,
      [byLogin.get('demo.atrisk').id, nextDay, 'Family wedding out of town', `${addDays(today, -1)}T16:00:00Z`],
    );

    // ---- what people were told, and the audit trail -------------------------
    const everyone = (await tx.query(`select id from users where role <> 'admin'`)).rows.map((r) => r.id);
    const notify = (ids, title, message, category, postedBy, createdAt) => tx.query(
      `insert into notifications (recipient_id, title, message, category, posted_by, created_at)
       select id, $2, $3, $4, $5, $6 from unnest($1::uuid[]) as id`,
      [ids, title, message, category, postedBy, createdAt],
    );
    await notify(everyone, 'Welcome to the demo college',
      'The timetable is the real D2 BBA routine; the students, marks and events around it are made up for the demo. Look around, mark a register, apply for leave, join an event.',
      'announcement', hod.id, `${addDays(today, -1)}T03:00:00Z`);
    if (festSlot) {
      await notify(students.map((s) => s.id), 'Class cancelled for Tech Fest 2026',
        `Period 4 (${festSlot.subject_name}) on ${festDay} will not be held: Tech Fest 2026. Nothing will be marked, and it does not count towards attendance.`,
        'schedule', hod.id, `${addDays(today, -1)}T10:00:00Z`);
    }
    await notify([karan.id], 'Leave approved', `Your leave from ${leaveDays[0]} to ${leaveDays[1]} was approved. Note: Certificate seen`,
      'leave', classTeacher.id, `${addDays(leaveDays[0], -1)}T11:00:00Z`);
    await notify([classTeacher.id, hod.id], 'New leave request', `Rohit Nair (D2-02) has applied for leave on ${nextDay}.`,
      'leave', byLogin.get('demo.atrisk').id, `${addDays(today, -1)}T16:00:00Z`);
    await notify([mentor.id], 'New join request', 'Two students have asked to join "Case Study Challenge".',
      'event', null, `${addDays(today, -1)}T08:00:00Z`);

    activity.push(
      { actor_id: hod.id, actor_role: 'hod', action_type: 'class.cancelled', target_entity: 'class_cancellation', target_id: rainBatch,
        reason: 'College closed for heavy rain', details: { date: rainDay, sections: ['D2'] }, created_at: `${addDays(rainDay, -1)}T14:00:00Z` },
      { actor_id: classTeacher.id, actor_role: 'teacher', action_type: 'leave.approved', target_entity: 'leave_request',
        reason: 'Certificate seen', details: { student: karan.name, from: leaveDays[0], to: leaveDays[1] }, created_at: `${addDays(leaveDays[0], -1)}T11:00:00Z` },
      { actor_id: mentor.id, actor_role: 'mentor', action_type: 'event.created', target_entity: 'event', target_id: contest.id,
        details: { title: contest.title, date: contestDay, credit_periods: [3, 4] }, created_at: `${addDays(contestDay, -6)}T06:00:00Z` },
      { actor_id: mentor.id, actor_role: 'mentor', action_type: 'event.created', target_entity: 'event', target_id: challenge.id,
        details: { title: challenge.title, date: challengeDay, credit_periods: [4] }, created_at: `${addDays(today, -2)}T06:00:00Z` },
      { actor_id: hod.id, actor_role: 'hod', action_type: 'event.created', target_entity: 'event', target_id: fest.id,
        details: { title: fest.title, date: festDay }, created_at: `${addDays(today, -3)}T06:00:00Z` },
    );
    if (festSlot) {
      activity.push({ actor_id: hod.id, actor_role: 'hod', action_type: 'class.cancelled', target_entity: 'class_cancellation', target_id: festBatch,
        reason: 'Tech Fest 2026 — no class after the break', details: { date: festDay, periods: [4], event: fest.title }, created_at: `${addDays(today, -1)}T10:00:00Z` });
    }
    await tx.query(
      `insert into activity_log (actor_id, actor_role, action_type, target_entity, target_id, reason, details, created_at)
       select actor_id, actor_role, action_type, target_entity, target_id, reason, coalesce(details, '{}'::jsonb), created_at
         from jsonb_to_recordset($1::jsonb) as x(actor_id uuid, actor_role text, action_type text, target_entity text,
              target_id uuid, reason text, details jsonb, created_at timestamptz)`,
      [JSON.stringify(activity)],
    );

    await tx.query(
      'insert into app_settings (key, value) values ($1, $2)',
      [MARKER, JSON.stringify({ seeded_at: new Date().toISOString(), history_from: past[0], routine: ROUTINE.title })],
    );

    console.log(`demo college seeded around "${ROUTINE.title}":
  ${past.length} class days, ${records.length} marks, ${sessionRows.length} classes on record.
  Every demo account uses the password ${DEMO_PASSWORD}.
    demo.hod       HOD
    demo.teacher   Teacher SS, class teacher of D2
    demo.student   Student with the 90% badge
    demo.atrisk    Student below the minimum
    demo.mentor    Mentor of the Entrepreneurship Cell
    demo.admin     Administrator
  Set DEMO_MODE=1 on the server for one-tap sign-in buttons.`);
  });
}

seed()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
