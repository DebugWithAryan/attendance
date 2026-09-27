-- ============================================================
-- 006_timetable_sessions.sql
--
-- Two things the timetable could not express before:
--
--   1. What a college week looks like. Every screen assumed six days of eight
--      periods, so a college that runs five days of four had a grid that did
--      not match its routine. Days, periods and the printed timings (period
--      times, the break, what happens after classes) now live on the course,
--      and every grid and picker reads them.
--
--   2. Whether a class actually happened. The register only knew about
--      students who had a mark, so "classes held" meant something different
--      for every student in the same room. class_sessions records each class
--      once: 'held' when its register is taken, 'cancelled' when it is called
--      off in advance (a holiday, a strike, a fest). A cancelled class can
--      never be marked, and a held one counts for every student on the roll.
-- ============================================================

alter table courses add column if not exists periods_per_day smallint not null default 8
  check (periods_per_day between 1 and 12);
-- Monday through this day. Five for a college that does not teach on Saturday.
alter table courses add column if not exists days_per_week smallint not null default 6
  check (days_per_week between 1 and 6);
-- Display only: { periods: ["10:15–11:15", ...], breakAfter: 3, breakTime: "1:25–2:15",
--                 afterHoursTime: "After 3:15", afterHours: { "1": "Mentorship", ... } }
alter table courses add column if not exists timings jsonb;

-- A period could not be cleared from the timetable once a register had been
-- taken in it: the attendance rows pointed at the slot with no rule for its
-- removal, and the HOD got "one of the linked records no longer exists". The
-- rows keep their section, subject, date and period, so they lose nothing but
-- the link.
alter table attendance_records drop constraint if exists attendance_records_slot_id_fkey;
alter table attendance_records add constraint attendance_records_slot_id_fkey
  foreign key (slot_id) references schedule_slots(id) on delete set null;

create table class_sessions (
  id            uuid primary key default gen_random_uuid(),
  section_id    uuid not null references sections(id) on delete cascade,
  course_id     uuid not null references courses(id) on delete cascade,
  subject_id    uuid not null references subjects(id) on delete cascade,
  slot_id       uuid references schedule_slots(id) on delete set null,
  teacher_id    uuid references users(id),
  class_date    date not null,
  period_number smallint not null check (period_number between 1 and 12),
  status        text not null check (status in ('held', 'cancelled')),
  -- Cancellations only: why, and which one-tap action it came from, so the
  -- whole action can be undone together.
  reason        text,
  batch_id      uuid,
  event_id      uuid references events(id) on delete set null,
  recorded_by   uuid references users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One truth per class: it cannot be both held and cancelled.
  unique (section_id, class_date, period_number)
);
create index class_sessions_section_idx on class_sessions (section_id, status, class_date);
create index class_sessions_date_idx    on class_sessions (class_date, status);
create index class_sessions_batch_idx   on class_sessions (batch_id) where batch_id is not null;

-- Every class a teacher or the HOD has already marked was held. The earliest
-- teacher mark is when its register was first taken.
insert into class_sessions
  (section_id, course_id, subject_id, slot_id, teacher_id, class_date, period_number,
   status, recorded_by, created_at, updated_at)
select distinct on (r.section_id, r.class_date, r.period_number)
       r.section_id, sec.course_id, r.subject_id, r.slot_id,
       coalesce(sl.teacher_id, r.marked_by), r.class_date, r.period_number,
       'held', r.marked_by, r.marked_at, r.marked_at
  from attendance_records r
  join sections sec on sec.id = r.section_id
  left join schedule_slots sl on sl.id = r.slot_id
 where r.source in ('teacher', 'hod')
 order by r.section_id, r.class_date, r.period_number, r.marked_at
on conflict (section_id, class_date, period_number) do nothing;

-- A register means the class was held, whoever saves it. The app records the
-- session before it saves the marks, so for the app this finds nothing to do.
-- It is here for every other writer: above all the previous version of the
-- app, which keeps serving while a new deployment builds and knows nothing of
-- class_sessions. Without it, a register taken in that minute would count for
-- its students but never as a class held.
create or replace function note_held_classes() returns trigger language plpgsql as $$
begin
  insert into class_sessions
    (section_id, course_id, subject_id, slot_id, teacher_id, class_date, period_number,
     status, recorded_by, created_at, updated_at)
  select distinct on (r.section_id, r.class_date, r.period_number)
         r.section_id, sec.course_id, r.subject_id, r.slot_id,
         coalesce(sl.teacher_id, r.marked_by), r.class_date, r.period_number,
         'held', r.marked_by, r.marked_at, r.marked_at
    from new_rows r
    join sections sec on sec.id = r.section_id
    left join schedule_slots sl on sl.id = r.slot_id
   where r.source in ('teacher', 'hod')
   order by r.section_id, r.class_date, r.period_number, r.marked_at
  on conflict (section_id, class_date, period_number) do nothing;
  return null;
end $$;

drop trigger if exists trg_note_held_classes on attendance_records;
create trigger trg_note_held_classes
  after insert on attendance_records
  referencing new table as new_rows
  for each statement execute function note_held_classes();
