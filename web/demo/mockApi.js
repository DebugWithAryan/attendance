/**
 * Demo-only. Replaces window.fetch with an in-memory implementation of the same
 * API the Node server exposes, seeded with the same demo department, so the
 * real UI can be published as a clickable link.
 *
 * It mirrors the server's rules, not its code: percentages exclude approved
 * leave, event credits flag overrides, and every consequential action writes an
 * activity row. Nothing here ships to production.
 */
const uid = (() => { let n = 0; return (p) => `${p}-${(n += 1)}`; })();
const iso = (d) => d.toISOString().slice(0, 10);
const dayOf = (s) => { const d = new Date(`${s}T00:00:00Z`); return d.getUTCDay() === 0 ? 7 : d.getUTCDay(); };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SUBJECTS = ['Data Structures', 'Operating Systems', 'Databases', 'Computer Networks', 'Mathematics III', 'Professional Ethics'];
const TEACHERS = [['Ravi Shankar', 'ravi'], ['Meera Iyer', 'meera'], ['Joseph Thomas', 'joseph'],
  ['Fathima Noor', 'fathima'], ['Karthik Rao', 'karthik'], ['Divya Nair', 'divya']];
const FIRST = ['Aarav', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Nithya', 'Vikram', 'Pooja'];

const db = {
  users: [], courses: [], sections: [], subjects: [], students: [], allocations: [],
  slots: [], criteria: {}, attendance: [], leave: [], clubs: [], members: [],
  events: [], creditPeriods: [], joins: [], credits: [], notifications: [], activity: [],
};

function seed() {
  const hod = { id: uid('u'), name: 'Dr. Anitha Menon', login_id: 'hod', role: 'hod', can_add_users: true, status: 'active' };
  db.users.push(hod);

  const course = { id: uid('c'), name: 'B.Tech Computer Science', created_by: hod.id };
  db.courses.push(course);
  db.criteria[course.id] = 75;

  const sections = ['CSE-A', 'CSE-B'].map((name) => {
    const s = { id: uid('s'), course_id: course.id, name };
    db.sections.push(s);
    return s;
  });

  const subjects = SUBJECTS.map((name) => {
    const s = { id: uid('sub'), course_id: course.id, name };
    db.subjects.push(s);
    return s;
  });

  const teachers = TEACHERS.map(([name, login_id]) => {
    const t = { id: uid('u'), name, login_id, role: 'teacher', can_add_users: login_id === 'ravi', status: 'active' };
    db.users.push(t);
    return t;
  });

  const mentor = { id: uid('u'), name: 'Sundar Balan', login_id: 'mentor', role: 'mentor', can_add_users: false, status: 'active' };
  db.users.push(mentor);

  sections.forEach((section, i) => db.allocations.push({ section_id: section.id, course_id: course.id, teacher_id: teachers[i].id }));

  sections.forEach((section, sIdx) => {
    for (let day = 1; day <= 6; day += 1) {
      for (let period = 1; period <= 5; period += 1) {
        db.slots.push({
          id: uid('sl'), course_id: course.id, section_id: section.id, day_of_week: day, period_number: period,
          subject_id: subjects[(day + period + sIdx) % subjects.length].id,
          teacher_id: teachers[(period + sIdx * 3) % teachers.length].id,
        });
      }
    }
  });

  sections.forEach((section, sIdx) => {
    FIRST.forEach((first, i) => {
      const user = {
        id: uid('u'), name: `${first} ${sIdx === 0 ? 'Kumar' : 'Menon'}`,
        login_id: `${section.name.toLowerCase()}${i + 1}`, role: 'student', can_add_users: false, status: 'active',
      };
      db.users.push(user);
      db.students.push({
        user_id: user.id, course_id: course.id, section_id: section.id,
        roll_number: `${sIdx === 0 ? 'A' : 'B'}${String(i + 1).padStart(3, '0')}`,
      });
    });
  });

  // Three weeks of history so percentages and the red flags mean something.
  // Deterministic, so the demo looks the same on every open.
  let n = 7;
  const rand = () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
  const today = new Date(`${iso(new Date())}T00:00:00Z`);
  for (let back = 21; back >= 1; back -= 1) {
    const date = iso(addDays(today, -back));
    if (dayOf(date) === 7) continue;
    for (const slot of db.slots.filter((s) => s.day_of_week === dayOf(date))) {
      for (const student of db.students.filter((s) => s.section_id === slot.section_id)) {
        const seat = Number(student.roll_number.slice(1));
        // a couple of students per section sit well below the line
        const chance = seat >= 9 ? 0.55 : seat === 4 ? 0.72 : 0.93;
        db.attendance.push({
          id: uid('a'), student_id: student.user_id, section_id: slot.section_id, subject_id: slot.subject_id,
          slot_id: slot.id, class_date: date, period_number: slot.period_number,
          status: rand() < chance ? 'present' : 'absent', source: 'teacher',
          marked_by: slot.teacher_id, marked_at: `${date}T10:00:00Z`, last_updated_at: `${date}T10:00:00Z`,
          last_updated_by: slot.teacher_id,
        });
      }
    }
  }

  const club = { id: uid('cl'), name: 'Robotics Club', mentor_id: mentor.id, created_at: new Date().toISOString() };
  db.clubs.push(club);
  db.students.slice(10, 14).forEach((s) => db.members.push({ club_id: club.id, student_id: s.user_id, added_by: mentor.id }));

  const student = db.students[12];
  db.leave.push({
    id: uid('lr'), student_id: student.user_id, from_date: iso(addDays(today, -2)), to_date: iso(addDays(today, -2)),
    reason: 'Viral fever, advised one day rest. Certificate attached.', has_document: true,
    status: 'pending', created_at: new Date().toISOString(),
  });

  log(hod, 'user.created', 'user', hod.id, { role: 'hod', name: hod.name });
}

const user = (id) => db.users.find((u) => u.id === id);
const studentRow = (id) => db.students.find((s) => s.user_id === id);
const sectionRow = (id) => db.sections.find((s) => s.id === id);
const courseRow = (id) => db.courses.find((c) => c.id === id);
const subjectRow = (id) => db.subjects.find((s) => s.id === id);
const hodIds = () => db.users.filter((u) => u.role === 'hod').map((u) => u.id);

function log(actor, action_type, target_entity, target_id, details, reason) {
  db.activity.unshift({
    id: uid('log'), actor_id: actor.id, actor_name: actor.name, actor_role: actor.role,
    action_type, target_entity, target_id, details: details || {}, reason: reason || null,
    created_at: new Date().toISOString(),
  });
}

function notify(ids, message, from) {
  [...new Set([].concat(ids).filter(Boolean))].forEach((id) => db.notifications.unshift({
    id: uid('n'), recipient_id: id, title: message.title, message: message.body || null,
    category: message.category || 'general', posted_by: from?.id || null, posted_by_name: from?.name || null,
    read_at: null, created_at: new Date().toISOString(),
  }));
}

const counts = (rows) => {
  const present_count = rows.filter((r) => r.status === 'present').length;
  const absent_count = rows.filter((r) => r.status === 'absent').length;
  const leave_count = rows.filter((r) => r.status === 'leave').length;
  const base = present_count + absent_count;
  return {
    conducted: present_count + absent_count + leave_count,
    present_count, absent_count, leave_count, not_marked: 0,
    percentage: base === 0 ? null : Math.round((present_count / base) * 10000) / 100,
  };
};

// The demo marks every student in every class it holds, so "held" is simply
// the distinct classes on record for a section.
const heldFor = (sectionId) => new Set(db.attendance.filter((a) => a.section_id === sectionId)
  .map((a) => `${a.class_date}:${a.period_number}`)).size;
const BADGE = 90;
const badgeFor = (c) => ({
  earned: c.percentage !== null && c.percentage >= BADGE, threshold: BADGE, current: c.percentage,
  needed: c.percentage !== null && c.percentage >= BADGE ? 0 : classesNeeded(c, BADGE).needed,
});
const WEEK = { days_per_week: 6, periods_per_day: 5, timings: null };

const classesNeeded = (c, minimum) => {
  const base = c.present_count + c.absent_count;
  if (minimum >= 100) return { needed: null, current: c.percentage, unreachable: true };
  if (c.percentage !== null && c.percentage >= minimum) return { needed: 0, current: c.percentage, unreachable: false };
  const m = minimum / 100;
  return { needed: Math.max(0, Math.ceil((m * base - c.present_count) / (1 - m))), current: c.percentage, unreachable: false };
};

const minimumFor = (courseId) => db.criteria[courseId] ?? 75;

const actorFrom = (token) => {
  const u = user(String(token || '').replace('demo.', ''));
  return u && u.status === 'active'
    ? { id: u.id, name: u.name, loginId: u.login_id, role: u.role, canAddUsers: u.can_add_users }
    : null;
};

function recordsFor({ courseId, sectionId, from, to }) {
  return db.students
    .filter((s) => (!courseId || s.course_id === courseId) && (!sectionId || s.section_id === sectionId))
    .filter((s) => user(s.user_id)?.status === 'active')
    .map((s) => {
      const rows = db.attendance.filter((a) => a.student_id === s.user_id
        && (!from || a.class_date >= from) && (!to || a.class_date <= to));
      const c = counts(rows);
      const minimum = minimumFor(s.course_id);
      return {
        student_id: s.user_id, name: user(s.user_id).name, login_id: user(s.user_id).login_id,
        roll_number: s.roll_number, course_name: courseRow(s.course_id).name, section_name: sectionRow(s.section_id).name,
        course_id: s.course_id, section_id: s.section_id, ...c, minimum,
        section_classes_held: heldFor(s.section_id),
        belowMinimum: c.percentage !== null && c.percentage < minimum,
        badge: c.percentage !== null && c.percentage >= BADGE,
      };
    })
    .sort((a, b) => a.section_name.localeCompare(b.section_name) || a.roll_number.localeCompare(b.roll_number));
}

const courseAverages = () => db.sections.map((sec) => {
  const rows = recordsFor({ sectionId: sec.id }).filter((r) => r.percentage !== null);
  return {
    course_id: sec.course_id, course_name: courseRow(sec.course_id).name, section_name: sec.name,
    students: rows.length, classes_held: heldFor(sec.id), classes_cancelled: 0,
    avg_percentage: rows.length ? Math.round((rows.reduce((a, r) => a + r.percentage, 0) / rows.length) * 100) / 100 : null,
  };
});

const slotView = (slot, actor) => ({
  id: slot.id, section_id: slot.section_id, section_name: sectionRow(slot.section_id).name,
  course_name: courseRow(slot.course_id).name, day_of_week: slot.day_of_week, period_number: slot.period_number,
  subject_id: slot.subject_id, subject_name: subjectRow(slot.subject_id).name,
  teacher_id: slot.teacher_id, teacher_name: user(slot.teacher_id).name,
  mine: slot.teacher_id === actor.id,
});

const eventView = (e, actor) => ({
  ...e,
  posted_by_name: user(e.created_by).name,
  club_name: e.club_id ? db.clubs.find((c) => c.id === e.club_id)?.name : null,
  credit_periods: db.creditPeriods.filter((p) => p.event_id === e.id).map((p) => p.period_number).sort(),
  my_request_status: db.joins.find((j) => j.event_id === e.id && j.student_id === actor.id)?.status || null,
  pending_count: db.joins.filter((j) => j.event_id === e.id && j.status === 'pending').length,
  approved_count: db.joins.filter((j) => j.event_id === e.id && j.status === 'approved').length,
  credited_students: 0,
  cancelled_classes: 0,
  my_credits: [],
  my_not_credited: [],
});

const clubView = (c) => ({
  ...c,
  mentor_name: user(c.mentor_id).name,
  mentor_login_id: user(c.mentor_id).login_id,
  members: db.members.filter((m) => m.club_id === c.id).map((m) => ({
    student_id: m.student_id, name: user(m.student_id).name, login_id: user(m.student_id).login_id,
    roll_number: studentRow(m.student_id)?.roll_number,
  })).sort((a, b) => String(a.roll_number).localeCompare(String(b.roll_number))),
});

const pendingLeaveFor = (actor) => {
  if (actor.role === 'hod') return db.leave.filter((l) => l.status === 'pending').length;
  const mine = db.allocations.filter((a) => a.teacher_id === actor.id).map((a) => a.section_id);
  return db.leave.filter((l) => l.status === 'pending' && mine.includes(studentRow(l.student_id)?.section_id)).length;
};

const leaveView = (l) => ({
  ...l,
  student_name: user(l.student_id).name,
  roll_number: studentRow(l.student_id)?.roll_number,
  section_name: sectionRow(studentRow(l.student_id)?.section_id)?.name,
});

const json = (body, status = 200, headers = {}) =>
  new Response(body === null ? '' : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
const fail = (status, message) => json({ error: 'error', message }, status);

/* ------------------------------------------------------------------ */

function handle(method, path, query, body, actor) {
  // --- auth
  if (method === 'POST' && path === '/auth/login') {
    const u = db.users.find((x) => x.login_id.toLowerCase() === String(body.loginId || '').toLowerCase() && x.status === 'active');
    if (!u || body.password !== 'password123') return fail(401, 'That login ID and password do not match.');
    return json({
      token: `demo.${u.id}`,
      user: { id: u.id, name: u.name, loginId: u.login_id, role: u.role, canAddUsers: u.can_add_users },
    });
  }
  // --- public: the sign-in page asks these before anyone is signed in. A 401
  // here would make the app reload the page, over and over.
  if (method === 'GET' && path === '/bootstrap') return json({ needed: false });
  if (method === 'GET' && path === '/demo') {
    const buttons = [
      ['hod', 'HOD', 'Builds the timetable, cancels classes, decides leave.'],
      ['ravi', 'Teacher', 'Marks the register in a few taps.'],
      ['cse-b1', 'Student', 'Sees where they stand, and the badge at 90%.'],
      ['mentor', 'Mentor', 'Runs a club and credits event attendance.'],
    ];
    return json({
      enabled: true,
      password: 'password123',
      accounts: buttons.map(([loginId, label, blurb]) => {
        const u = db.users.find((x) => x.login_id === loginId);
        return { loginId, role: u.role, label, blurb, name: u.name };
      }),
    });
  }
  if (method === 'POST' && path === '/demo/login') {
    const u = db.users.find((x) => x.login_id === body.loginId && x.status === 'active');
    if (!u) return fail(404, 'That demo account is not set up.');
    return json({ token: `demo.${u.id}`, user: { id: u.id, name: u.name, loginId: u.login_id, role: u.role, canAddUsers: u.can_add_users } });
  }
  if (!actor) return fail(401, 'Sign in to continue.');

  if (method === 'GET' && path === '/auth/me') {
    if (actor.role === 'student') {
      const s = studentRow(actor.id);
      const alloc = db.allocations.find((a) => a.section_id === s.section_id);
      return json({
        ...actor,
        profile: {
          id: actor.id, name: actor.name, login_id: actor.loginId, roll_number: s.roll_number,
          course_id: s.course_id, section_id: s.section_id,
          course_name: courseRow(s.course_id).name, section_name: sectionRow(s.section_id).name,
          class_teacher_id: alloc?.teacher_id, class_teacher_name: alloc ? user(alloc.teacher_id).name : null,
        },
      });
    }
    if (actor.role === 'teacher') {
      return json({
        ...actor,
        profile: {
          id: actor.id, name: actor.name, login_id: actor.loginId,
          assignments: [...new Map(db.slots.filter((s) => s.teacher_id === actor.id).map((s) => [
            `${s.section_id}-${s.subject_id}`,
            { course: courseRow(s.course_id).name, section: sectionRow(s.section_id).name, subject: subjectRow(s.subject_id).name },
          ])).values()],
          class_teacher_of: db.allocations.filter((a) => a.teacher_id === actor.id).map((a) => a.section_id),
        },
      });
    }
    return json({ ...actor, profile: { id: actor.id, name: actor.name, login_id: actor.loginId } });
  }
  if (method === 'POST' && path === '/auth/password') {
    if (body.currentPassword !== 'password123') return fail(400, 'Your current password is not correct.');
    return json({ ok: true, demo: true });
  }

  // --- structure
  if (method === 'GET' && path === '/courses') {
    return json(db.courses.map((c) => ({
      ...WEEK, ...c, min_attendance: db.criteria[c.id] ?? null,
      section_count: db.sections.filter((s) => s.course_id === c.id).length,
    })));
  }
  if (method === 'POST' && path === '/courses') {
    const c = { id: uid('c'), name: body.name, created_by: actor.id };
    db.courses.push(c);
    log(actor, 'course.created', 'course', c.id, { name: c.name });
    return json(c, 201);
  }
  if (method === 'GET' && path === '/sections') {
    return json(db.sections.filter((s) => !query.courseId || s.course_id === query.courseId).map((s) => {
      const alloc = db.allocations.find((a) => a.section_id === s.id);
      return {
        ...s, class_teacher_id: alloc?.teacher_id, class_teacher_name: alloc ? user(alloc.teacher_id).name : null,
        student_count: db.students.filter((st) => st.section_id === s.id).length,
      };
    }));
  }
  if (method === 'POST' && path === '/sections') {
    const s = { id: uid('s'), course_id: body.courseId, name: body.name };
    db.sections.push(s);
    log(actor, 'section.created', 'section', s.id, { name: s.name });
    return json(s, 201);
  }
  if (method === 'GET' && path === '/subjects') {
    return json(db.subjects.filter((s) => !query.courseId || s.course_id === query.courseId));
  }
  if (method === 'POST' && path === '/subjects') {
    const s = { id: uid('sub'), course_id: body.courseId, name: body.name };
    db.subjects.push(s);
    log(actor, 'subject.created', 'subject', s.id, { name: s.name });
    return json(s, 201);
  }
  if (method === 'GET' && path === '/users') {
    if (['student', 'mentor'].includes(actor.role)) return json([]);
    return json(db.users.filter((u) => u.role === query.role && u.status === 'active').map((u) => {
      const s = studentRow(u.id);
      return {
        ...u, roll_number: s?.roll_number,
        course_name: s ? courseRow(s.course_id).name : null,
        section_name: s ? sectionRow(s.section_id).name : null,
        course_id: s?.course_id, section_id: s?.section_id,
      };
    }));
  }
  if (method === 'POST' && path === '/users') {
    if (actor.role === 'teacher' && !['student', 'mentor'].includes(body.role)) {
      return fail(403, `You cannot create ${body.role} accounts.`);
    }
    if (db.users.some((u) => u.login_id.toLowerCase() === body.loginId.toLowerCase())) {
      return fail(409, 'That login ID is already taken.');
    }
    const u = {
      id: uid('u'), name: body.name, login_id: body.loginId, role: body.role,
      can_add_users: !!body.canAddUsers, status: 'active', created_by: actor.id,
    };
    db.users.push(u);
    if (body.role === 'student') {
      db.students.push({ user_id: u.id, course_id: body.courseId, section_id: body.sectionId, roll_number: body.rollNumber });
    }
    log(actor, 'user.created', 'user', u.id, { role: u.role, login_id: u.login_id, name: u.name });
    notify(u.id, { title: 'Welcome to the attendance portal', body: `Sign in with ${u.login_id}.` }, actor);
    return json(u, 201);
  }
  if (method === 'DELETE' && path.startsWith('/users/')) {
    const target = user(path.split('/')[2]);
    if (!target) return fail(404, 'That account does not exist.');
    target.status = 'removed';
    log(actor, 'user.removed', 'user', target.id, { name: target.name, role: target.role });
    return json({ id: target.id, name: target.name });
  }
  if (method === 'POST' && path === '/allocations/class-teacher') {
    db.allocations = db.allocations.filter((a) => a.section_id !== body.sectionId);
    db.allocations.push({ section_id: body.sectionId, course_id: body.courseId, teacher_id: body.teacherId });
    log(actor, 'allocation.class_teacher', 'section', body.sectionId, { teacher_name: user(body.teacherId).name });
    notify(body.teacherId, { title: 'You are now a class teacher' }, actor);
    return json({ section_id: body.sectionId });
  }
  if (method === 'PUT' && path === '/criteria') {
    db.criteria[body.courseId] = body.percentage;
    log(actor, 'criteria.updated', 'course', body.courseId, { percentage: body.percentage });
    return json({ course_id: body.courseId, percentage: body.percentage });
  }

  // --- schedule
  if (method === 'GET' && path.startsWith('/schedule/course/')) {
    const courseId = path.split('/')[3];
    const course = courseRow(courseId);
    return json({
      days: DAYS, daysPerWeek: 6, periodsPerDay: WEEK.periods_per_day, timings: null,
      course: { id: course.id, name: course.name },
      slots: db.slots.filter((s) => s.course_id === courseId).map((s) => slotView(s, actor)),
    });
  }
  if (method === 'GET' && path === '/schedule/mine') {
    const s = studentRow(actor.id);
    return json({
      days: DAYS, daysPerWeek: 6, periodsPerDay: WEEK.periods_per_day, timings: null,
      section: sectionRow(s.section_id).name, sectionId: s.section_id, course: courseRow(s.course_id).name,
      slots: db.slots.filter((x) => x.section_id === s.section_id).map((x) => slotView(x, actor)),
    });
  }
  if (method === 'PUT' && path === '/schedule/slot') {
    if (db.slots.some((s) => s.teacher_id === body.teacherId && s.day_of_week === body.dayOfWeek
      && s.period_number === body.periodNumber && s.section_id !== body.sectionId)) {
      return fail(409, 'That teacher already has a class in this period. Pick another teacher or period.');
    }
    db.slots = db.slots.filter((s) => !(s.section_id === body.sectionId && s.day_of_week === body.dayOfWeek
      && s.period_number === body.periodNumber));
    const slot = {
      id: uid('sl'), course_id: body.courseId, section_id: body.sectionId, day_of_week: body.dayOfWeek,
      period_number: body.periodNumber, subject_id: body.subjectId, teacher_id: body.teacherId,
    };
    db.slots.push(slot);
    log(actor, 'schedule.slot_saved', 'schedule_slot', slot.id, { day: slot.day_of_week, period: slot.period_number });
    return json(slot);
  }
  if (method === 'DELETE' && path.startsWith('/schedule/slot/')) {
    const id = path.split('/')[3];
    const slot = db.slots.find((s) => s.id === id);
    db.slots = db.slots.filter((s) => s.id !== id);
    log(actor, 'schedule.slot_removed', 'schedule_slot', id, { day: slot?.day_of_week, period: slot?.period_number });
    return json(slot || {});
  }

  // --- attendance
  if (path === '/attendance/roster') {
    const sectionId = query.sectionId || body?.sectionId;
    const classDate = query.classDate || body?.classDate;
    const periodNumber = Number(query.periodNumber || body?.periodNumber);
    const day = dayOf(classDate);
    if (day === 7) return fail(400, 'There are no classes on Sunday.');
    const slot = db.slots.find((s) => s.section_id === sectionId && s.day_of_week === day && s.period_number === periodNumber);
    if (!slot) return fail(404, 'The timetable has no class in that period for this section.');
    if (actor.role === 'teacher' && slot.teacher_id !== actor.id) return fail(403, 'That period belongs to another teacher.');

    if (method === 'POST') {
      let saved = 0;
      const tally = {};
      for (const mark of body.marks) {
        const existing = db.attendance.find((a) => a.student_id === mark.student_id
          && a.class_date === classDate && a.period_number === periodNumber);
        if (existing) {
          if (existing.status !== mark.status) { existing.edited_by = actor.id; existing.edited_at = new Date().toISOString(); }
          Object.assign(existing, { status: mark.status, source: 'teacher', last_updated_by: actor.id, last_updated_at: new Date().toISOString() });
        } else {
          db.attendance.push({
            id: uid('a'), student_id: mark.student_id, section_id: sectionId, subject_id: slot.subject_id,
            slot_id: slot.id, class_date: classDate, period_number: periodNumber, status: mark.status,
            source: 'teacher', marked_by: actor.id, marked_at: new Date().toISOString(),
            last_updated_by: actor.id, last_updated_at: new Date().toISOString(),
          });
        }
        saved += 1;
        tally[mark.status] = (tally[mark.status] || 0) + 1;
      }
      log(actor, 'attendance.saved', 'section', sectionId, { class_date: classDate, period: periodNumber, tally });
      return json({ saved, tally });
    }

    const students = db.students.filter((s) => s.section_id === sectionId)
      .filter((s) => user(s.user_id).status === 'active')
      .sort((a, b) => a.roll_number.localeCompare(b.roll_number))
      .map((s) => {
        const record = db.attendance.find((a) => a.student_id === s.user_id
          && a.class_date === classDate && a.period_number === periodNumber);
        const onLeave = db.leave.some((l) => l.student_id === s.user_id && l.status === 'approved'
          && classDate >= l.from_date && classDate <= l.to_date);
        return {
          studentId: s.user_id, recordId: record?.id, name: user(s.user_id).name,
          loginId: user(s.user_id).login_id, rollNumber: s.roll_number,
          status: record?.status ?? (onLeave ? 'leave' : null), source: record?.source,
          overrideNote: record?.override_note, onApprovedLeave: onLeave,
          lastUpdatedAt: record?.last_updated_at,
          lastUpdatedBy: record?.last_updated_by ? user(record.last_updated_by)?.name : null,
          savedAt: record?.marked_at,
        };
      });

    return json({
      slot: { id: slot.id, subjectId: slot.subject_id, periodNumber, dayOfWeek: day, classDate },
      editWindowHours: 48, students,
    });
  }

  if (method === 'PATCH' && path.startsWith('/attendance/record/')) {
    const record = db.attendance.find((a) => a.id === path.split('/')[3]);
    if (!record) return fail(404, 'That attendance record no longer exists.');
    if (!body.reason || body.reason.trim().length < 3) return fail(400, 'Add a short reason for the change.');
    if (actor.role === 'teacher') {
      if (record.marked_by !== actor.id) return fail(403, 'Only the teacher who marked this class can edit it.');
      const hours = (Date.now() - new Date(record.marked_at).getTime()) / 36e5;
      if (hours > 48) return fail(403, 'The 48-hour edit window has closed. The HOD can still correct this record.');
    }
    const from = record.status;
    Object.assign(record, {
      status: body.status, source: actor.role === 'hod' ? 'hod' : 'teacher',
      edited_by: actor.id, edited_at: new Date().toISOString(), edit_reason: body.reason,
      last_updated_by: actor.id, last_updated_at: new Date().toISOString(),
    });
    log(actor, actor.role === 'hod' ? 'attendance.override' : 'attendance.edited', 'attendance_record', record.id,
      { from, to: body.status, class_date: record.class_date, period: record.period_number }, body.reason);
    notify(record.student_id, {
      title: 'Your attendance was corrected',
      body: `${from} changed to ${body.status} on ${record.class_date}. Reason: ${body.reason}`,
    }, actor);
    return json(record);
  }

  if (method === 'GET' && path.startsWith('/attendance/student/')) {
    const id = path.split('/')[3];
    if (actor.role === 'student' && id !== actor.id) return fail(403, 'You can only see your own attendance.');
    if (actor.role === 'mentor') return fail(403, 'Mentors do not have access to attendance data.');
    const s = studentRow(id);
    const alloc = db.allocations.find((a) => a.section_id === s.section_id);
    const minimum = minimumFor(s.course_id);
    const subjects = db.subjects.filter((sub) => sub.course_id === s.course_id).map((sub) => {
      const c = counts(db.attendance.filter((a) => a.student_id === id && a.subject_id === sub.id));
      return {
        subject_id: sub.id, subject_name: sub.name, ...c,
        belowMinimum: c.percentage !== null && c.percentage < minimum, ...classesNeeded(c, minimum),
      };
    });
    const overall = counts(db.attendance.filter((a) => a.student_id === id));
    return json({
      badge: badgeFor(overall),
      classesHeld: { section: heldFor(s.section_id), cancelled: 0 },
      eventCredits: [],
      profile: {
        id, name: user(id).name, login_id: user(id).login_id, roll_number: s.roll_number,
        course_id: s.course_id, course_name: courseRow(s.course_id).name, section_name: sectionRow(s.section_id).name,
        class_teacher_name: alloc ? user(alloc.teacher_id).name : null,
      },
      minimum,
      overall: { ...overall, belowMinimum: overall.percentage !== null && overall.percentage < minimum, ...classesNeeded(overall, minimum) },
      subjects,
    });
  }

  if (method === 'GET' && path === '/records') return json(recordsFor(query));

  if (method === 'GET' && path === '/records/export') {
    const rows = recordsFor(query).filter((r) => (query.onlyBelow === 'true' ? r.belowMinimum : true));
    const cols = [
      ['Roll number', 'roll_number'], ['Name', 'name'], ['Login ID', 'login_id'], ['Course', 'course_name'],
      ['Section', 'section_name'], ['Classes held', 'conducted'], ['Present', 'present_count'],
      ['Absent', 'absent_count'], ['Approved leave', 'leave_count'], ['Attendance %', 'percentage'], ['Minimum %', 'minimum'],
    ];
    const csv = [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => r[c[1]] ?? '').join(','))].join('\n');
    const name = `attendance-${query.onlyBelow === 'true' ? 'below-minimum' : 'full'}-${iso(new Date())}.csv`;
    log(actor, 'records.exported', 'export', null, { scope: query.onlyBelow === 'true' ? 'below_minimum' : 'all', row_count: rows.length });
    return new Response(csv, {
      status: 200,
      headers: { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${name}"`, 'x-row-count': String(rows.length) },
    });
  }

  if (method === 'GET' && path === '/analytics/courses') {
    if (actor.role === 'student') return fail(403, 'Students see only their own attendance.');
    return json(courseAverages());
  }

  // --- leave
  if (method === 'POST' && path === '/leave/document') {
    if (!/^data:(image\/(jpeg|png|webp|heic)|application\/pdf);base64,/.test(body?.dataUrl || '')) {
      return fail(400, 'Upload a JPG, PNG, WEBP or PDF file.');
    }
    return json({ url: body.dataUrl });   // the demo keeps it in memory
  }
  if (method === 'POST' && path === '/leave') {
    const l = {
      id: uid('lr'), student_id: actor.id, from_date: body.fromDate, to_date: body.toDate,
      reason: body.reason, has_document: !!body.certificate, status: 'pending', created_at: new Date().toISOString(),
    };
    db.leave.unshift(l);
    const alloc = db.allocations.find((a) => a.section_id === studentRow(actor.id).section_id);
    notify([alloc?.teacher_id, ...hodIds()], { title: 'New leave request', body: `${actor.name} applied for leave.` }, actor);
    log(actor, 'leave.applied', 'leave_request', l.id, { from: l.from_date, to: l.to_date });
    return json(l, 201);
  }
  if (method === 'GET' && path === '/leave/mine') return json(db.leave.filter((l) => l.student_id === actor.id));
  if (method === 'GET' && path === '/leave/queue') {
    const mine = db.allocations.filter((a) => a.teacher_id === actor.id).map((a) => a.section_id);
    return json(db.leave
      .filter((l) => !query.status || l.status === query.status)
      .filter((l) => actor.role === 'hod' || mine.includes(studentRow(l.student_id)?.section_id))
      .map(leaveView));
  }
  if (method === 'GET' && path === '/leave/history') {
    return json(db.leave.filter((l) => l.decided_by === actor.id).map(leaveView));
  }
  if (method === 'PATCH' && path.startsWith('/leave/')) {
    const l = db.leave.find((x) => x.id === path.split('/')[2]);
    if (!l) return fail(404, 'That leave request no longer exists.');
    if (l.status !== 'pending') return fail(400, 'This request has already been decided.');
    Object.assign(l, {
      status: body.status, decided_by: actor.id, decider_role: actor.role,
      decided_at: new Date().toISOString(), decision_note: body.note || null,
    });

    let periodsMarked = 0;
    if (body.status === 'approved') {
      const s = studentRow(l.student_id);
      for (let d = new Date(`${l.from_date}T00:00:00Z`); iso(d) <= l.to_date; d = addDays(d, 1)) {
        const date = iso(d);
        for (const slot of db.slots.filter((x) => x.section_id === s.section_id && x.day_of_week === dayOf(date))) {
          const existing = db.attendance.find((a) => a.student_id === l.student_id
            && a.class_date === date && a.period_number === slot.period_number);
          if (existing && existing.source === 'event_credit') continue;
          if (existing) {
            Object.assign(existing, { status: 'leave', source: 'leave_approval', override_note: 'Changed to approved leave', last_updated_by: actor.id });
          } else {
            db.attendance.push({
              id: uid('a'), student_id: l.student_id, section_id: s.section_id, subject_id: slot.subject_id,
              slot_id: slot.id, class_date: date, period_number: slot.period_number, status: 'leave',
              source: 'leave_approval', marked_by: actor.id, marked_at: new Date().toISOString(),
              override_note: 'Marked as approved leave', last_updated_by: actor.id, last_updated_at: new Date().toISOString(),
            });
          }
          periodsMarked += 1;
        }
      }
      const teacherIds = db.slots.filter((x) => x.section_id === s.section_id).map((x) => x.teacher_id);
      notify([...teacherIds, ...hodIds()], {
        title: 'Approved leave affects your roster',
        body: `${user(l.student_id).name} is on approved leave from ${l.from_date} to ${l.to_date}. ${periodsMarked} periods marked as leave.`,
      }, actor);
    }
    notify(l.student_id, { title: `Leave ${body.status}`, body: body.note || undefined }, actor);
    log(actor, body.status === 'approved' ? 'leave.approved' : 'leave.rejected', 'leave_request', l.id,
      { student: user(l.student_id).name, from: l.from_date, to: l.to_date, periods_marked: periodsMarked }, body.note);
    return json({ ...l, periodsMarked });
  }

  if (method === 'PATCH' && /^\/leave\/[^/]+\/decision$/.test(path)) {
    const l = db.leave.find((x) => x.id === path.split('/')[2]);
    if (!l) return fail(404, 'That leave request no longer exists.');
    if (l.status === 'pending') return fail(400, 'This request has not been decided yet.');
    if (l.status === body.status) return fail(400, `This request is already ${body.status}.`);
    if (actor.role !== 'hod' && l.decided_by !== actor.id) {
      return fail(403, 'Only the approver who made this decision, or the HOD, can change it.');
    }
    const from = l.status;
    const s2 = studentRow(l.student_id);
    let periodsChanged = 0;
    if (body.status === 'rejected') {
      const before = db.attendance.length;
      db.attendance = db.attendance.filter((a) => !(a.student_id === l.student_id
        && a.class_date >= l.from_date && a.class_date <= l.to_date && a.source === 'leave_approval'));
      periodsChanged = before - db.attendance.length;
    } else {
      for (let d = new Date(`${l.from_date}T00:00:00Z`); iso(d) <= l.to_date; d = addDays(d, 1)) {
        for (const slot of db.slots.filter((x) => x.section_id === s2.section_id && x.day_of_week === dayOf(iso(d)))) {
          const existing = db.attendance.find((a) => a.student_id === l.student_id
            && a.class_date === iso(d) && a.period_number === slot.period_number);
          if (existing) Object.assign(existing, { status: 'leave', source: 'leave_approval' });
          else {
            db.attendance.push({
              id: uid('a'), student_id: l.student_id, section_id: s2.section_id, subject_id: slot.subject_id,
              slot_id: slot.id, class_date: iso(d), period_number: slot.period_number, status: 'leave',
              source: 'leave_approval', marked_by: actor.id, marked_at: new Date().toISOString(),
              last_updated_by: actor.id, last_updated_at: new Date().toISOString(),
            });
          }
          periodsChanged += 1;
        }
      }
    }
    Object.assign(l, { status: body.status, decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: body.reason });
    notify(l.student_id, { title: `Leave decision changed to ${body.status}`, body: body.reason }, actor);
    log(actor, 'leave.decision_revised', 'leave_request', l.id,
      { student: user(l.student_id).name, from_status: from, to_status: body.status, periods_changed: periodsChanged }, body.reason);
    return json({ ...l, periodsChanged });
  }

  if (method === 'POST' && /^\/users\/[^/]+\/password$/.test(path)) {
    const target = user(path.split('/')[2]);
    if (!target) return fail(404, 'That account does not exist.');
    log(actor, 'user.password_reset', 'user', target.id, { name: target.name, login_id: target.login_id });
    notify(target.id, { title: 'Your password was changed' }, actor);
    return json({ id: target.id, login_id: target.login_id });
  }

  if (method === 'POST' && path === '/users/import') {
    const lines = String(body.csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (/^roll[_ ]?number\s*,/i.test(lines[0])) lines.shift();
    const failed = [];
    let created = 0;
    lines.forEach((line, i) => {
      const [roll, name, loginId, password] = line.split(',').map((c) => (c || '').trim());
      if (!roll || !name || !loginId || !password) {
        failed.push({ line: i + 1, value: line.slice(0, 40), reason: 'needs roll number, name, login ID and password' });
      } else if (password.length < 8) {
        failed.push({ line: i + 1, value: loginId, reason: 'password must be at least 8 characters' });
      } else if (db.users.some((u) => u.login_id.toLowerCase() === loginId.toLowerCase())) {
        failed.push({ line: i + 1, value: loginId, reason: 'That login ID is already taken.' });
      } else {
        const u = { id: uid('u'), name, login_id: loginId, role: 'student', can_add_users: false, status: 'active' };
        db.users.push(u);
        db.students.push({ user_id: u.id, course_id: body.courseId, section_id: body.sectionId, roll_number: roll });
        created += 1;
      }
    });
    log(actor, 'users.imported', 'section', body.sectionId, { created, failed: failed.length });
    return json({ created, failed, sample: [] });
  }

  // --- events, clubs
  if (method === 'GET' && path === '/events') {
    return json(db.events.filter((e) => actor.role === 'hod' || e.created_by === actor.id
      || e.visibility === 'all_students'
      || db.members.some((m) => m.club_id === e.club_id && m.student_id === actor.id))
      .map((e) => eventView(e, actor)));
  }
  if (method === 'POST' && path === '/events') {
    if (body.visibility === 'members_only' && !body.clubId) return fail(400, 'A members-only event needs a club.');
    const e = {
      id: uid('e'), title: body.title, description: body.description || null, event_date: body.eventDate,
      created_by: actor.id, creator_role: actor.role, club_id: body.clubId || null,
      visibility: body.visibility, created_at: new Date().toISOString(),
    };
    db.events.unshift(e);
    (body.creditPeriods || []).forEach((p) => db.creditPeriods.push({ event_id: e.id, period_number: p }));
    log(actor, 'event.created', 'event', e.id, { title: e.title, credit_periods: body.creditPeriods, visibility: e.visibility });
    return json(eventView(e, actor), 201);
  }
  if (method === 'GET' && path.match(/^\/events\/[^/]+\/requests$/)) {
    const eventId = path.split('/')[2];
    const e = db.events.find((x) => x.id === eventId);
    if (e.created_by !== actor.id && actor.role !== 'hod') return fail(403, 'Only the person who posted this event can see its join requests.');
    return json(db.joins.filter((j) => j.event_id === eventId).map((j) => ({
      ...j, student_name: user(j.student_id).name, login_id: user(j.student_id).login_id,
      roll_number: studentRow(j.student_id)?.roll_number,
      section_name: sectionRow(studentRow(j.student_id)?.section_id)?.name,
      credits: [], not_credited: [],
    })));
  }
  if (method === 'POST' && path.match(/^\/events\/[^/]+\/join$/)) {
    const eventId = path.split('/')[2];
    const e = db.events.find((x) => x.id === eventId);
    if (e.visibility === 'members_only' && !db.members.some((m) => m.club_id === e.club_id && m.student_id === actor.id)) {
      return fail(403, 'This event is open to club members only.');
    }
    if (db.joins.some((j) => j.event_id === eventId && j.student_id === actor.id)) {
      return fail(400, 'You have already asked to join this event.');
    }
    const j = { id: uid('jr'), event_id: eventId, student_id: actor.id, status: 'pending', created_at: new Date().toISOString() };
    db.joins.push(j);
    notify(e.created_by, { title: 'New join request', body: `A student asked to join "${e.title}".` }, actor);
    log(actor, 'event.join_requested', 'event', eventId, { title: e.title });
    return json(j);
  }
  if (method === 'PATCH' && path.startsWith('/events/requests/')) {
    const j = db.joins.find((x) => x.id === path.split('/')[3]);
    if (!j) return fail(404, 'That join request no longer exists.');
    if (j.status !== 'pending') return fail(400, 'This request has already been decided.');
    const e = db.events.find((x) => x.id === j.event_id);
    if (e.created_by !== actor.id && actor.role !== 'hod') {
      return fail(403, 'Only the person who posted this event can approve join requests.');
    }
    Object.assign(j, { status: body.status, decided_by: actor.id, decided_at: new Date().toISOString() });

    const credits = [];
    if (body.status === 'approved') {
      const s = studentRow(j.student_id);
      const day = dayOf(e.event_date);
      for (const period of db.creditPeriods.filter((p) => p.event_id === e.id).map((p) => p.period_number)) {
        const slot = db.slots.find((x) => x.section_id === s.section_id && x.day_of_week === day && x.period_number === period);
        if (!slot) { credits.push({ period, skipped: 'no class scheduled in this period' }); continue; }
        const existing = db.attendance.find((a) => a.student_id === j.student_id
          && a.class_date === e.event_date && a.period_number === period);
        const note = `Marked present — credited via "${e.title}" by ${actor.name}`;
        let wasOverride = false;
        let record = existing;
        if (!existing) {
          record = {
            id: uid('a'), student_id: j.student_id, section_id: s.section_id, subject_id: slot.subject_id,
            slot_id: slot.id, class_date: e.event_date, period_number: period, status: 'present',
            source: 'event_credit', marked_by: actor.id, marked_at: new Date().toISOString(),
            override_note: note, last_updated_by: actor.id, last_updated_at: new Date().toISOString(),
          };
          db.attendance.push(record);
        } else if (existing.status !== 'present') {
          wasOverride = existing.source === 'teacher';
          Object.assign(existing, {
            status: 'present', source: 'event_credit', edited_by: actor.id, edited_at: new Date().toISOString(),
            override_note: wasOverride ? `${note}, overriding the teacher's original mark of ${existing.status}` : note,
            last_updated_by: actor.id, last_updated_at: new Date().toISOString(),
          });
        }
        db.credits.push({
          id: uid('cr'), event_id: e.id, student_id: j.student_id, period_number: period,
          attendance_record_id: record.id, previous_status: existing?.status ?? null, was_override: wasOverride,
        });
        credits.push({ period, previousStatus: existing?.status ?? null, wasOverride });
        notify(slot.teacher_id, {
          title: wasOverride ? 'Your attendance mark was overridden' : 'Attendance credited for your class',
          body: `${user(j.student_id).name} was marked present for period ${period} on ${e.event_date} through "${e.title}".`,
        }, actor);
        log(actor, wasOverride ? 'attendance.credit_override' : 'attendance.credited', 'attendance_record', record.id,
          { event: e.title, student: user(j.student_id).name, period, previous_status: existing?.status ?? 'none' },
          `Event credit: ${e.title}`);
      }
      notify(hodIds(), { title: 'Event attendance credited', body: `${user(j.student_id).name} received credit through "${e.title}".` }, actor);
    } else {
      log(actor, 'event.join_rejected', 'event', e.id, { student: user(j.student_id).name, title: e.title });
    }
    notify(j.student_id, { title: `Join request ${body.status}`, body: `"${e.title}"` }, actor);
    return json({ ...j, credits });
  }

  if (method === 'GET' && path === '/clubs') {
    if (!['hod', 'mentor'].includes(actor.role)) return fail(403, 'Clubs are managed by mentors.');
    return json(db.clubs.filter((c) => actor.role === 'hod' || c.mentor_id === actor.id).map(clubView));
  }
  if (method === 'POST' && path === '/clubs') {
    if (db.clubs.some((c) => c.name.toLowerCase() === body.name.toLowerCase())) {
      return fail(409, 'A club with that name already exists.');
    }
    const c = { id: uid('cl'), name: body.name, mentor_id: actor.id, created_at: new Date().toISOString() };
    db.clubs.push(c);
    log(actor, 'club.created', 'club', c.id, { name: c.name });
    return json(c, 201);
  }
  if (method === 'POST' && path.match(/^\/clubs\/[^/]+\/members$/)) {
    const clubId = path.split('/')[2];
    const student = db.users.find((u) => u.login_id.toLowerCase() === String(body.loginId).toLowerCase()
      && u.role === 'student' && u.status === 'active');
    if (!student) return fail(400, 'No active student has that login ID.');
    if (db.members.some((m) => m.club_id === clubId && m.student_id === student.id)) {
      return fail(400, `${student.name} is already a member.`);
    }
    db.members.push({ club_id: clubId, student_id: student.id, added_by: actor.id });
    notify(student.id, { title: `Added to ${db.clubs.find((c) => c.id === clubId).name}` }, actor);
    log(actor, 'club.member_added', 'club', clubId, { student: student.name, login_id: student.login_id });
    return json({ studentId: student.id, name: student.name });
  }
  if (method === 'DELETE' && path.match(/^\/clubs\/[^/]+\/members\//)) {
    const [, , clubId, , studentId] = path.split('/');
    db.members = db.members.filter((m) => !(m.club_id === clubId && m.student_id === studentId));
    log(actor, 'club.member_removed', 'club', clubId, { student_id: studentId });
    return json({ ok: true });
  }

  // --- feeds
  if (method === 'GET' && path === '/notifications') {
    return json(db.notifications.filter((n) => n.recipient_id === actor.id).slice(0, 100));
  }
  if (method === 'POST' && path === '/notifications/read') {
    db.notifications.filter((n) => n.recipient_id === actor.id).forEach((n) => { n.read_at = new Date().toISOString(); });
    return json({ ok: true });
  }
  if (method === 'POST' && path === '/notifications') {
    const roles = { all_students: ['student'], teachers: ['teacher'], mentors: ['mentor'], everyone: ['student', 'teacher', 'mentor', 'hod'] }[body.audience];
    const ids = db.users.filter((u) => roles.includes(u.role) && u.status === 'active').map((u) => u.id);
    notify(ids, { title: body.title, body: body.message, category: 'announcement' }, actor);
    log(actor, 'notification.posted', 'notification', null, { title: body.title, audience: body.audience, recipients: ids.length });
    return json({ sent: ids.length });
  }
  if (method === 'GET' && path === '/activity') {
    if (actor.role !== 'hod') return fail(403, 'The audit trail is for the HOD.');
    return json(db.activity
      .filter((a) => (!query.action || a.action_type === query.action)
        && (!query.from || a.created_at.slice(0, 10) >= query.from)
        && (!query.to || a.created_at.slice(0, 10) <= query.to))
      .slice(0, Number(query.limit || 100)));
  }

  if (method === 'GET' && path === '/overview') {
    const day = dayOf(iso(new Date()));
    if (actor.role === 'student') {
      const s = studentRow(actor.id);
      const minimum = minimumFor(s.course_id);
      const overall = counts(db.attendance.filter((a) => a.student_id === actor.id));
      return json({
        role: 'student',
        attendance: { ...overall, belowMinimum: overall.percentage !== null && overall.percentage < minimum, ...classesNeeded(overall, minimum) },
        minimum,
        badge: badgeFor(overall),
        classesHeld: { section: heldFor(s.section_id), cancelled: 0 },
        section: sectionRow(s.section_id).name,
        timings: null,
        upcomingCancellations: [],
        subjectCount: db.subjects.filter((x) => x.course_id === s.course_id).length,
        todayClasses: db.slots.filter((x) => x.section_id === s.section_id && x.day_of_week === day).map((x) => slotView(x, actor)),
        pendingLeave: db.leave.filter((l) => l.student_id === actor.id && l.status === 'pending').length,
      });
    }
    if (actor.role === 'teacher') {
      return json({
        role: 'teacher',
        upcomingCancellations: [],
        todayClasses: db.slots.filter((x) => x.teacher_id === actor.id && x.day_of_week === day).map((x) => slotView(x, actor)),
        pendingLeave: pendingLeaveFor(actor),
      });
    }
    if (actor.role === 'hod') {
      const counts = {
        courses: db.courses.length,
        sections: db.sections.length,
        subjects: db.subjects.length,
        teachers: db.users.filter((u) => u.role === 'teacher' && u.status === 'active').length,
        students: db.students.length,
        slots: db.slots.length,
        allocations: db.allocations.length,
        criteria: Object.keys(db.criteria).length,
        sections_without_teacher: db.sections.filter((x) => !db.allocations.some((a) => a.section_id === x.id)).length,
        sections_without_timetable: db.sections.filter((x) => !db.slots.some((sl) => sl.section_id === x.id)).length,
      };
      return json({
        role: 'hod',
        setup: {
          ...counts,
          complete: counts.courses > 0 && counts.subjects > 0 && counts.teachers > 0
            && counts.students > 0 && counts.sections_without_timetable === 0
            && counts.sections_without_teacher === 0 && counts.criteria > 0,
        },
        courseAverages: courseAverages(),
        classStats: {
          held: db.sections.reduce((n, sec) => n + heldFor(sec.id), 0), held_today: 0, cancelled: 0, cancelled_upcoming: 0,
        },
        upcomingCancellations: [],
        pendingLeave: pendingLeaveFor(actor),
        recentActivity: db.activity.slice(0, 12),
        recentEdits: db.attendance.filter((a) => a.edited_at).slice(0, 8).map((a) => ({
          id: a.id, class_date: a.class_date, period_number: a.period_number, status: a.status,
          source: a.source, override_note: a.override_note, edited_at: a.edited_at,
          edited_by_name: user(a.edited_by)?.name, student_name: user(a.student_id).name,
          subject_name: subjectRow(a.subject_id).name,
        })),
      });
    }
    return json({ role: 'mentor' });
  }

  // Cancellations and added event attendance need the real server's register.
  if (method === 'GET' && path === '/classes/cancellations') return json([]);
  if ((method === 'POST' && path === '/classes/cancel') || (method === 'POST' && /^\/events\/[^/]+\/attendance$/.test(path))) {
    return fail(400, 'This clickable demo only shows the screens. Run the app with npm run seed:demo to try this for real.');
  }

  return fail(404, `No demo handler for ${method} ${path}`);
}

export function installMockApi() {
  seed();
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api')) return realFetch(input, init);

    const [rawPath, rawQuery] = url.slice(4).split('?');
    const query = Object.fromEntries(new URLSearchParams(rawQuery || ''));
    const token = (init.headers?.authorization || '').replace('Bearer ', '');
    const body = init.body instanceof FormData ? {} : (init.body ? JSON.parse(init.body) : null);

    // A beat of latency, so loading states are visible rather than theoretical.
    await new Promise((r) => setTimeout(r, 120));
    try {
      return handle(init.method || 'GET', rawPath, query, body, actorFrom(token));
    } catch (err) {
      return fail(500, `Demo error: ${err.message}`);
    }
  };
}
