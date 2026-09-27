/**
 * Creates the minimum a college needs to start: one HOD, one course with two
 * sections, subjects, teachers, a mentor, students and a six-day timetable.
 * Safe to re-run — it exits if an HOD already exists.
 */
import { pool, withTransaction } from './pool.js';
import { hashPassword } from '../security/password.js';

const SUBJECTS = ['Data Structures', 'Operating Systems', 'Databases', 'Computer Networks', 'Mathematics III', 'Professional Ethics'];

async function seed() {
  const existing = await pool.query(`select 1 from users where role = 'hod' limit 1`);
  if (existing.rowCount) {
    console.log('seed skipped: an HOD account already exists');
    return;
  }

  const password = await hashPassword('password123');

  await withTransaction(async (tx) => {
    const hod = (await tx.query(
      `insert into users (name, login_id, password_hash, role) values ($1,$2,$3,'hod') returning id`,
      ['Dr. Anitha Menon', 'hod', password],
    )).rows[0];

    // Five periods a day, matching the timetable below.
    const course = (await tx.query(
      'insert into courses (name, created_by, periods_per_day) values ($1,$2,5) returning id',
      ['B.Tech Computer Science', hod.id],
    )).rows[0];

    const sections = [];
    for (const name of ['CSE-A', 'CSE-B']) {
      sections.push((await tx.query(
        'insert into sections (course_id, name) values ($1,$2) returning id, name',
        [course.id, name],
      )).rows[0]);
    }

    const subjects = [];
    for (const name of SUBJECTS) {
      subjects.push((await tx.query(
        'insert into subjects (course_id, name) values ($1,$2) returning id, name',
        [course.id, name],
      )).rows[0]);
    }

    const teachers = [];
    const teacherNames = [
      ['Ravi Shankar', 'ravi'], ['Meera Iyer', 'meera'], ['Joseph Thomas', 'joseph'],
      ['Fathima Noor', 'fathima'], ['Karthik Rao', 'karthik'], ['Divya Nair', 'divya'],
    ];
    for (const [name, loginId] of teacherNames) {
      teachers.push((await tx.query(
        `insert into users (name, login_id, password_hash, role, can_add_users, created_by)
         values ($1,$2,$3,'teacher',$4,$5) returning id, name`,
        [name, loginId, password, loginId === 'ravi', hod.id],
      )).rows[0]);
    }

    const mentor = (await tx.query(
      `insert into users (name, login_id, password_hash, role, created_by)
       values ($1,$2,$3,'mentor',$4) returning id`,
      ['Sundar Balan', 'mentor', password, hod.id],
    )).rows[0];

    // class teachers
    for (const [i, section] of sections.entries()) {
      await tx.query(
        `insert into class_teacher_allocations (section_id, course_id, teacher_id, assigned_by)
         values ($1,$2,$3,$4)`,
        [section.id, course.id, teachers[i].id, hod.id],
      );
    }

    // six-day timetable, 5 periods a day; each section gets a different teacher
    // in the same period so the teacher-clash constraint stays satisfied.
    for (const [sIdx, section] of sections.entries()) {
      for (let day = 1; day <= 6; day += 1) {
        for (let period = 1; period <= 5; period += 1) {
          const subject = subjects[(day + period + sIdx) % subjects.length];
          const teacher = teachers[(period + sIdx * 3) % teachers.length];
          await tx.query(
            `insert into schedule_slots (course_id, section_id, day_of_week, period_number, subject_id, teacher_id)
             values ($1,$2,$3,$4,$5,$6)`,
            [course.id, section.id, day, period, subject.id, teacher.id],
          );
        }
      }
    }

    // students
    const firstNames = ['Aarav', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Nithya', 'Vikram', 'Pooja'];
    for (const [sIdx, section] of sections.entries()) {
      for (let i = 0; i < 10; i += 1) {
        const roll = `${sIdx === 0 ? 'A' : 'B'}${String(i + 1).padStart(3, '0')}`;
        const loginId = `${section.name.toLowerCase()}${i + 1}`;
        const student = (await tx.query(
          `insert into users (name, login_id, password_hash, role, created_by)
           values ($1,$2,$3,'student',$4) returning id`,
          [`${firstNames[i]} ${sIdx === 0 ? 'Kumar' : 'Menon'}`, loginId, password, hod.id],
        )).rows[0];
        await tx.query(
          'insert into students (user_id, course_id, section_id, roll_number) values ($1,$2,$3,$4)',
          [student.id, course.id, section.id, roll],
        );
      }
    }

    await tx.query(
      'insert into attendance_criteria (course_id, percentage, set_by) values ($1,$2,$3)',
      [course.id, 75, hod.id],
    );
  });

  console.log(`seeded.
  HOD       hod / password123
  Teacher   ravi / password123        (also has add-account authority)
  Mentor    mentor / password123
  Student   cse-a1 / password123`);
}

seed()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
