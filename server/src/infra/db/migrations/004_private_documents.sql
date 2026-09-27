-- ============================================================
-- 004_private_documents.sql
-- Certificates stop being public URLs. The column now holds a private
-- reference the browser never sees; bytes are served through an authorised
-- endpoint that logs every view.
-- ============================================================
alter table leave_requests add column if not exists document_mime text;
alter table leave_requests rename column document_url to document_ref;
comment on column leave_requests.document_ref is
  'Private storage reference. Never send this to a client — serve bytes via GET /api/leave/:id/document.';
