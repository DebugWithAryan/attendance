-- ============================================================
-- 001_init.sql  |  College Attendance Management System
-- Postgres 14+. Run once on a fresh database.
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- identity ----------
create table users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  login_id      text not null unique,
  password_hash text not null,
  role          text not null check (role in ('hod','teacher','student','mentor')),
  status        text not null default 'active' check (status in ('active','removed')),
  can_add_users boolean not null default false,   -- HOD-granted authority for teachers
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);
create index users_role_status_idx on users(role, status);

-- ---------- academic structure ----------
create table courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table sections (
  id        uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  name      text not null,
  unique (course_id, name)
);

create table subjects (
  id        uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  name      text not null,
  code      text,
  unique (course_id, name)
);

create table students (
  user_id     uuid primary key references users(id) on delete cascade,
  course_id   uuid not null references courses(id),
  section_id  uuid not null references sections(id),
  roll_number text not null,
  unique (section_id, roll_number)
);
create index students_section_idx on students(section_id);

-- one class teacher per section
create table class_teacher_allocations (
  section_id  uuid primary key references sections(id) on delete cascade,
  course_id   uuid not null references courses(id) on delete cascade,
  teacher_id  uuid not null references users(id),
  assigned_by uuid not null references users(id),
  assigned_at timestamptz not null default now()
);

-- 6-day week, up to 12 periods a day
create table schedule_slots (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references courses(id) on delete cascade,
  section_id    uuid not null references sections(id) on delete cascade,
  day_of_week   smallint not null check (day_of_week between 1 and 6),
  period_number smallint not null check (period_number between 1 and 12),
  subject_id    uuid not null references subjects(id),
  teacher_id    uuid not null references users(id),
  unique (section_id, day_of_week, period_number),
  -- a teacher cannot be in two rooms at once
  unique (teacher_id, day_of_week, period_number)
);
create index slots_teacher_idx on schedule_slots(teacher_id, day_of_week);

create table attendance_criteria (
  course_id  uuid primary key references courses(id) on delete cascade,
  percentage numeric(5,2) not null check (percentage between 0 and 100),
  set_by     uuid not null references users(id),
  updated_at timestamptz not null default now()
);

-- global fallback + misc config
create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

-- ---------- attendance ----------
create table attendance_records (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references users(id) on delete cascade,
  section_id      uuid not null references sections(id),
  subject_id      uuid not null references subjects(id),
  slot_id         uuid references schedule_slots(id),
  class_date      date not null,
  period_number   smallint not null,
  status          text not null check (status in ('present','absent','leave','not_marked')),
  source          text not null default 'teacher'
                  check (source in ('teacher','hod','leave_approval','event_credit')),
  marked_by       uuid references users(id),
  marked_at       timestamptz not null default now(),
  edited_by       uuid references users(id),
  edited_at       timestamptz,
  edit_reason     text,
  override_note   text,               -- human-readable provenance for credits/overrides
  last_updated_by uuid references users(id),
  last_updated_at timestamptz not null default now(),
  -- one truth per student per period per day
  unique (student_id, class_date, period_number)
);
create index att_student_subject_idx on attendance_records(student_id, subject_id);
create index att_section_date_idx    on attendance_records(section_id, class_date);
create index att_marked_at_idx       on attendance_records(marked_at);

-- denormalised rollup: dashboards read this, never COUNT(*) the fact table
create table attendance_summary (
  student_id    uuid not null references users(id) on delete cascade,
  subject_id    uuid not null references subjects(id) on delete cascade,
  conducted     integer not null default 0,  -- present + absent + leave
  present_count integer not null default 0,
  absent_count  integer not null default 0,
  leave_count   integer not null default 0,
  percentage    numeric(5,2),                -- present / (present + absent)
  updated_at    timestamptz not null default now(),
  primary key (student_id, subject_id)
);

-- ---------- leave ----------
create table leave_requests (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references users(id) on delete cascade,
  from_date     date not null,
  to_date       date not null,
  reason        text not null,
  document_url  text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by    uuid references users(id),
  decider_role  text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date)
);
create index leave_status_idx  on leave_requests(status, created_at desc);
create index leave_student_idx on leave_requests(student_id);

-- ---------- clubs, events, credits ----------
create table clubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  mentor_id  uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table club_members (
  club_id    uuid not null references clubs(id) on delete cascade,
  student_id uuid not null references users(id) on delete cascade,
  added_by   uuid not null references users(id),
  added_at   timestamptz not null default now(),
  primary key (club_id, student_id)
);

create table events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  event_date   date not null,
  created_by   uuid not null references users(id),
  creator_role text not null check (creator_role in ('hod','teacher','mentor')),
  club_id      uuid references clubs(id) on delete set null,
  visibility   text not null default 'all_students'
               check (visibility in ('all_students','members_only')),
  created_at   timestamptz not null default now()
);
create index events_date_idx on events(event_date desc);

create table event_credit_periods (
  event_id      uuid not null references events(id) on delete cascade,
  period_number smallint not null check (period_number between 1 and 12),
  primary key (event_id, period_number)
);

create table event_join_requests (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  student_id uuid not null references users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, student_id)
);

create table attendance_credits (
  id                   uuid primary key default gen_random_uuid(),
  event_id             uuid not null references events(id) on delete cascade,
  student_id           uuid not null references users(id) on delete cascade,
  period_number        smallint not null,
  attendance_record_id uuid references attendance_records(id) on delete set null,
  previous_status      text,          -- null when no prior record existed
  was_override         boolean not null default false,
  credited_by          uuid not null references users(id),
  created_at           timestamptz not null default now(),
  unique (event_id, student_id, period_number)
);

-- ---------- notifications + audit ----------
create table notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references users(id) on delete cascade,
  title        text not null,
  message      text,
  category     text not null default 'general',
  posted_by    uuid references users(id),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notif_recipient_idx on notifications(recipient_id, created_at desc);

create table activity_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references users(id),
  actor_role    text,
  action_type   text not null,
  target_entity text,
  target_id     uuid,
  reason        text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index activity_created_idx on activity_log(created_at desc);
create index activity_action_idx  on activity_log(action_type, created_at desc);
