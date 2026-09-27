-- The account administrator.
--
-- Before this role existed, the only way to create the first HOD was a shell
-- with the production connection string, which is not something a college can
-- be asked to do. An admin is created once, from inside the app, on a database
-- with no users in it (see bootstrap in admin.service.js) and from then on
-- every account is made through the UI.
--
-- Admins administer accounts and oversee the department; they do not teach, so
-- they never appear in schedules, allocations or attendance as a participant.

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check
  check (role in ('admin','hod','teacher','student','mentor'));

-- Admins can post announcements and events like any other staff role.
alter table events drop constraint events_creator_role_check;
alter table events add constraint events_creator_role_check
  check (creator_role in ('admin','hod','teacher','mentor'));
