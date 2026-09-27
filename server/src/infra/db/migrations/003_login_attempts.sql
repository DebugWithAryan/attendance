-- ============================================================
-- 003_login_attempts.sql | brute-force protection that survives serverless
-- An in-memory counter is useless when every request may land on a different
-- instance, so the counter lives where all instances can see it.
-- ============================================================
create table login_attempts (
  login_id   text not null,
  attempted_at timestamptz not null default now(),
  succeeded  boolean not null default false
);
create index login_attempts_lookup_idx on login_attempts (lower(login_id), attempted_at desc);
