-- ============================================================
-- 007_demo_accounts.sql
--
-- Accounts made by `npm run seed:demo` for a public demonstration, such as a
-- tech fest stall. Their passwords are printed on a poster, so the flag is
-- what lets the server protect them: nobody can change, reset or remove a
-- demo account, and one-tap demo sign-in only ever reaches these rows, and
-- only while DEMO_MODE is switched on.
-- ============================================================

alter table users add column if not exists is_demo boolean not null default false;
create index if not exists users_demo_idx on users (role) where is_demo;
