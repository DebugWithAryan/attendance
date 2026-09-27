import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Select } from '../components/Bits.jsx';

/**
 * The HOD's setup bench: courses, sections, subjects, accounts, the class
 * teacher allocation and the minimum percentage. A teacher with add-authority
 * sees only the accounts panel.
 */
export default function Setup() {
  const { user } = useAuth();
  const isHod = user.role === 'hod';
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const courses = useApi('/courses');
  const [courseId, setCourseId] = useState('');
  const sections = useApi(courseId ? `/sections?courseId=${courseId}` : null, { skip: !courseId });
  const subjects = useApi(courseId ? `/subjects?courseId=${courseId}` : null, { skip: !courseId });
  const teachers = useApi(isHod ? '/users?role=teacher' : null, { skip: !isHod });

  const run = async (fn, message) => {
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Setup" note={isHod ? 'Build the department once; everything else reads from this.' : 'Create student and mentor accounts.'} />

      <div className="stack">
        {error && <Problem>{error}</Problem>}
        {done && <div className="notice good">{done}</div>}

        {isHod && (
          <>
            <Courses courses={courses} onDone={run} />
            <div className="panel">
              <div className="body row">
                <Select label="Working on course" value={courseId}
                  options={(courses.data || []).map((c) => ({ value: c.id, label: c.name }))} onChange={setCourseId} />
                {courseId && <span className="label">{(sections.data || []).length} sections · {(subjects.data || []).length} subjects</span>}
              </div>
            </div>

            {courseId && (
              <>
                <SectionsAndSubjects
                  courseId={courseId} sections={sections} subjects={subjects} onDone={run}
                />
                <Allocation courseId={courseId} sections={sections} teachers={teachers.data || []} onDone={run} />
                <Criteria courseId={courseId} courses={courses} onDone={run} />
              </>
            )}
          </>
        )}

        <Accounts
          isHod={isHod}
          courses={courses.data || []}
          onDone={run}
        />
      </div>
    </>
  );
}

function Courses({ courses, onDone }) {
  const [name, setName] = useState('');
  return (
    <div className="panel">
      <header><h3>Courses</h3></header>
      <div className="body stack" style={{ gap: '0.75rem' }}>
        <div className="row">
          <label className="field" style={{ flex: 1, minWidth: '14rem' }}>
            New course<input value={name} onChange={(e) => setName(e.target.value)} placeholder="B.Tech Computer Science" />
          </label>
          <button disabled={name.trim().length < 2}
            onClick={() => onDone(async () => { await api.post('/courses', { name: name.trim() }); setName(''); await courses.reload(); }, 'Course added.')}>
            Add course
          </button>
        </div>
        {courses.loading ? <Loading /> : (
          <ul className="plain">
            {(courses.data || []).map((c) => (
              <li key={c.id}>{c.name} <span className="label">· {c.section_count} sections · minimum {c.min_attendance ?? 'not set'}%</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SectionsAndSubjects({ courseId, sections, subjects, onDone }) {
  const [section, setSection] = useState('');
  const [subject, setSubject] = useState('');
  return (
    <div className="grid-2">
      <div className="panel">
        <header><h3>Sections</h3></header>
        <div className="body stack" style={{ gap: '0.75rem' }}>
          <div className="row">
            <label className="field"><input value={section} onChange={(e) => setSection(e.target.value)} placeholder="CSE-A" /></label>
            <button disabled={!section.trim()}
              onClick={() => onDone(async () => { await api.post('/sections', { courseId, name: section.trim() }); setSection(''); await sections.reload(); }, 'Section added.')}>
              Add
            </button>
          </div>
          <ul className="plain">
            {(sections.data || []).map((s) => (
              <li key={s.id}>{s.name} <span className="label">· {s.student_count} students · class teacher: {s.class_teacher_name || 'none'}</span></li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <header><h3>Subjects</h3></header>
        <div className="body stack" style={{ gap: '0.75rem' }}>
          <div className="row">
            <label className="field"><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Operating Systems" /></label>
            <button disabled={subject.trim().length < 2}
              onClick={() => onDone(async () => { await api.post('/subjects', { courseId, name: subject.trim() }); setSubject(''); await subjects.reload(); }, 'Subject added.')}>
              Add
            </button>
          </div>
          <ul className="plain">{(subjects.data || []).map((s) => <li key={s.id}>{s.name}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

function Allocation({ courseId, sections, teachers, onDone }) {
  const [sectionId, setSectionId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  return (
    <div className="panel">
      <header><h3>Allocation</h3><span className="label">One class teacher per section</span></header>
      <div className="body row">
        <Select label="Section" value={sectionId} options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))} onChange={setSectionId} />
        <Select label="Class teacher" value={teacherId} options={teachers.map((t) => ({ value: t.id, label: `${t.name} (${t.login_id})` }))} onChange={setTeacherId} />
        <button disabled={!sectionId || !teacherId}
          onClick={() => onDone(async () => {
            await api.post('/allocations/class-teacher', { courseId, sectionId, teacherId });
            await sections.reload();
          }, 'Class teacher allocated and notified.')}>
          Allocate
        </button>
      </div>
    </div>
  );
}

function Criteria({ courseId, courses, onDone }) {
  const [percentage, setPercentage] = useState(75);
  return (
    <div className="panel">
      <header><h3>Minimum attendance</h3></header>
      <div className="body row">
        <label className="field">
          Percentage
          <input type="number" min="0" max="100" value={percentage} onChange={(e) => setPercentage(e.target.value)} />
        </label>
        <button onClick={() => onDone(async () => {
          await api.put('/criteria', { courseId, percentage: Number(percentage) });
          await courses.reload();
        }, 'Minimum updated. Records and student dashboards use it immediately.')}>
          Save minimum
        </button>
      </div>
    </div>
  );
}

function Accounts({ isHod, courses, onDone }) {
  const [role, setRole] = useState('student');
  const [resetting, setResetting] = useState(null);
  const [bulk, setBulk] = useState({ open: false, csv: '', result: null });
  const [form, setForm] = useState({ name: '', loginId: '', password: '', courseId: '', sectionId: '', rollNumber: '', canAddUsers: false });
  const sections = useApi(form.courseId ? `/sections?courseId=${form.courseId}` : null, { skip: !form.courseId });
  const list = useApi(`/users?role=${role}`);

  const roleOptions = isHod
    ? [{ value: 'student', label: 'Student' }, { value: 'teacher', label: 'Teacher' }, { value: 'mentor', label: 'Mentor' }]
    : [{ value: 'student', label: 'Student' }, { value: 'mentor', label: 'Mentor' }];

  const create = () => onDone(async () => {
    await api.post('/users', {
      name: form.name.trim(),
      loginId: form.loginId.trim(),
      password: form.password,
      role,
      canAddUsers: role === 'teacher' ? form.canAddUsers : undefined,
      courseId: role === 'student' ? form.courseId : undefined,
      sectionId: role === 'student' ? form.sectionId : undefined,
      rollNumber: role === 'student' ? form.rollNumber.trim() : undefined,
    });
    setForm({ ...form, name: '', loginId: '', password: '', rollNumber: '' });
    await list.reload();
  }, 'Account created. The login ID and password work right away.');

  const remove = (id) => onDone(async () => {
    await api.del(`/users/${id}`);
    await list.reload();
  }, 'Account removed. They can no longer sign in.');

  const valid = form.name.trim().length > 1 && form.loginId.trim().length > 2 && form.password.length >= 8
    && (role !== 'student' || (form.courseId && form.sectionId && form.rollNumber.trim()));

  return (
    <div className="panel">
      <header>
        <h3>Accounts</h3>
        <div className="row">
          {roleOptions.map((r) => (
            <button key={r.value} className={role === r.value ? '' : 'quiet'} onClick={() => setRole(r.value)}>{r.label}</button>
          ))}
        </div>
      </header>

      <div className="body stack" style={{ gap: '0.75rem' }}>
        <div className="row">
          <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field">Login ID<input value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} placeholder="cse-a11" /></label>
          <label className="field">Password<input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="at least 8 characters" /></label>
          {role === 'student' && (
            <>
              <Select label="Course" value={form.courseId} options={courses.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => setForm({ ...form, courseId: v, sectionId: '' })} />
              <Select label="Section" value={form.sectionId} options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))}
                onChange={(v) => setForm({ ...form, sectionId: v })} />
              <label className="field">Roll number<input value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} /></label>
            </>
          )}
          {role === 'teacher' && (
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.375rem' }}>
              <input type="checkbox" checked={form.canAddUsers} onChange={(e) => setForm({ ...form, canAddUsers: e.target.checked })} style={{ minHeight: 0 }} />
              Can add student and mentor accounts
            </label>
          )}
          <button disabled={!valid} onClick={create}>Create account</button>
        </div>

        {resetting && (
          <div className="notice">
            <p className="label">
              Setting a new password for <strong>{resetting.name}</strong>. There is no reset-by-email in this
              system, so tell them the new password yourself. They are notified that it changed.
            </p>
            <div className="row">
              <label className="field">
                New password
                <input type="text" value={resetting.password} autoFocus
                  onChange={(e) => setResetting({ ...resetting, password: e.target.value })}
                  placeholder="at least 8 characters" />
              </label>
              <button disabled={resetting.password.length < 8}
                onClick={() => onDone(async () => {
                  await api.post(`/users/${resetting.id}/password`, { password: resetting.password });
                  setResetting(null);
                }, 'Password changed. Tell them what it is.')}>
                Save password
              </button>
              <button className="quiet" onClick={() => setResetting(null)}>Cancel</button>
            </div>
          </div>
        )}

        {role === 'student' && (
          <div className="notice">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="label">
                Adding a whole section? Paste a CSV instead of typing each student.
              </span>
              <button className="quiet" onClick={() => setBulk({ ...bulk, open: !bulk.open })}>
                {bulk.open ? 'Hide' : 'Bulk import'}
              </button>
            </div>

            {bulk.open && (
              <div className="stack" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
                <p className="label" style={{ margin: 0 }}>
                  One student per line: <code>roll_number,name,login_id,password</code>. A header row is
                  fine. Students go into the course and section selected above, so set those first.
                </p>
                <textarea
                  rows={8}
                  value={bulk.csv}
                  onChange={(e) => setBulk({ ...bulk, csv: e.target.value })}
                  placeholder={'A001,Aarav Kumar,cse-a1,firstpass123\nA002,Diya Menon,cse-a2,firstpass456'}
                />
                <div className="row">
                  <button
                    disabled={!form.courseId || !form.sectionId || bulk.csv.trim().length < 5}
                    onClick={() => onDone(async () => {
                      const result = await api.post('/users/import', {
                        courseId: form.courseId, sectionId: form.sectionId, csv: bulk.csv,
                      });
                      setBulk({ open: true, csv: result.failed.length ? bulk.csv : '', result });
                      await list.reload();
                    }, 'Import finished. Check the result below.')}
                  >
                    Import students
                  </button>
                  {(!form.courseId || !form.sectionId) && (
                    <span className="label">Pick a course and section in the form above first.</span>
                  )}
                </div>

                {bulk.result && (
                  <div className={bulk.result.failed.length ? 'notice bad' : 'notice good'}>
                    <strong>{bulk.result.created} created.</strong>
                    {bulk.result.failed.length > 0 && (
                      <>
                        {' '}{bulk.result.failed.length} rejected — fix these lines and paste again:
                        <ul className="plain" style={{ marginTop: '0.375rem' }}>
                          {bulk.result.failed.slice(0, 12).map((f) => (
                            <li key={f.line}>Line {f.line} ({f.value}): {f.reason}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {list.loading ? <Loading /> : (list.data || []).length === 0 ? <Empty>No {role} accounts yet.</Empty> : (
          <div className="scroll-x">
            <table>
              <thead><tr><th>Name</th><th>Login ID</th>{role === 'student' && <><th>Roll</th><th>Section</th></>}<th /></tr></thead>
              <tbody>
                {(list.data || []).map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.login_id}{u.can_add_users ? ' · can add accounts' : ''}</td>
                    {role === 'student' && <><td>{u.roll_number}</td><td>{u.section_name}</td></>}
                    <td className="num">
                      <button className="link" onClick={() => setResetting({ id: u.id, name: u.name, password: '' })}>
                        set password
                      </button>
                      {' · '}
                      <button className="link" onClick={() => remove(u.id)}>remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
