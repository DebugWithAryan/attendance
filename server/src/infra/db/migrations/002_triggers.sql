-- ============================================================
-- 002_triggers.sql | keep attendance_summary in lockstep with facts
-- Cost model: O(rows for one student+subject) on write,
-- O(1) index lookup on every dashboard read.
-- ============================================================
create or replace function fn_sync_attendance_summary() returns trigger
language plpgsql as $$
declare
  v_student uuid;
  v_subject uuid;
begin
  if tg_op = 'DELETE' then
    v_student := old.student_id; v_subject := old.subject_id;
  else
    v_student := new.student_id; v_subject := new.subject_id;
  end if;

  insert into attendance_summary as s
    (student_id, subject_id, conducted, present_count, absent_count, leave_count, percentage, updated_at)
  select v_student, v_subject,
         count(*) filter (where status in ('present','absent','leave')),
         count(*) filter (where status = 'present'),
         count(*) filter (where status = 'absent'),
         count(*) filter (where status = 'leave'),
         case when count(*) filter (where status in ('present','absent')) = 0 then null
              else round(100.0 * count(*) filter (where status = 'present')
                         / count(*) filter (where status in ('present','absent')), 2) end,
         now()
    from attendance_records
   where student_id = v_student and subject_id = v_subject
  on conflict (student_id, subject_id) do update
    set conducted      = excluded.conducted,
        present_count  = excluded.present_count,
        absent_count   = excluded.absent_count,
        leave_count    = excluded.leave_count,
        percentage     = excluded.percentage,
        updated_at     = now();
  return null;
end $$;

drop trigger if exists trg_attendance_summary on attendance_records;
create trigger trg_attendance_summary
  after insert or update or delete on attendance_records
  for each row execute function fn_sync_attendance_summary();

-- stamp concurrency metadata on every write, so "last updated by X at Y" is never forgotten
create or replace function fn_stamp_attendance() returns trigger
language plpgsql as $$
begin
  new.last_updated_at := now();
  if new.last_updated_by is null then
    new.last_updated_by := coalesce(new.edited_by, new.marked_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_attendance on attendance_records;
create trigger trg_stamp_attendance
  before insert or update on attendance_records
  for each row execute function fn_stamp_attendance();
