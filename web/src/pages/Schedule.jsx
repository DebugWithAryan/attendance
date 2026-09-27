import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { DAY_NAMES, Done, Empty, Loading, PageHead, Problem, Select, periodList } from '../components/Bits.jsx';
import { CancelClasses, CancellationList } from '../components/Cancellations.jsx';

/**
 * One grid for everyone. A teacher's own classes are solid ink; everything else
 * is muted, so a timetable scan takes a second rather than a minute.
 *
 * For the HOD it is also the timetable builder. Every section of the course
 * gets its grid whether or not anything is in it yet (an empty section used to
 * get no grid at all, so its first period could never be added), the grid is
 * as wide as the course's day, and any period is allocated a subject and a
 * teacher right where it was tapped.
 */
export default function Schedule() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const isStudent = user.role === 'student';
  const canBuild = user.role === 'hod';
  const canCancel = ['hod', 'admin', 'teacher'].includes(user.role);

  const [courseId, setCourseId] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [editError, setEditError] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(params.get('cancel') === '1');

  const courses = useApi(isStudent ? null : '/courses', { skip: isStudent });
  const sections = useApi(courseId ? `/sections?courseId=${courseId}` : null, { skip: !courseId });
  const subjects = useApi(courseId && canBuild ? `/subjects?courseId=${courseId}` : null, { skip: !courseId || !canBuild });
  const teachers = useApi(canBuild ? '/users?role=teacher' : null, { skip: !canBuild });
  const grid = useApi(isStudent ? '/schedule/mine' : (courseId ? `/schedule/course/${courseId}` : null), { skip: !isStudent && !courseId });
  const cancellations = useApi('/classes/cancellations');

  // A department with a single course should not have to pick it.
  useEffect(() => {
    if (!isStudent && !courseId && courses.data?.length === 1) setCourseId(courses.data[0].id);
  }, [courses.data, courseId, isStudent]);

  const slots = grid.data?.slots || [];
  const days = grid.data?.days || [];
  const periods = periodList(grid.data?.periodsPerDay);
  // The printed routine: times under each period, the break, and what follows classes.
  const timings = grid.data?.timings || null;
  const breakAfter = timings?.breakAfter && timings.breakAfter < periods.length ? timings.breakAfter : null;
  const afterHours = timings && Object.keys(timings.afterHours || {}).length ? timings : null;
  const sectionsInGrid = isStudent
    ? (grid.data ? [{ id: grid.data.sectionId, name: grid.data.section }] : [])
    : (sections.data || []).filter((s) => !sectionFilter || s.id === sectionFilter);

  const cell = (sectionId, day, period) => slots.find((s) =>
    s.section_id === sectionId && s.day_of_week === day && s.period_number === period);

  const open = (section, day, period, slot) => {
    setEditError(null);
    setDone(null);
    setEditing({
      sectionId: section.id, sectionName: section.name, day, period,
      subjectId: slot?.subject_id || '', teacherId: slot?.teacher_id || '', existing: !!slot,
    });
  };

  const saveSlot = async () => {
    setEditError(null);
    try {
      await api.put('/schedule/slot', {
        courseId,
        sectionId: editing.sectionId,
        dayOfWeek: editing.day,
        periodNumber: editing.period,
        subjectId: editing.subjectId,
        teacherId: editing.teacherId,
      });
      const subject = (subjects.data || []).find((s) => s.id === editing.subjectId)?.name;
      const teacher = (teachers.data || []).find((t) => t.id === editing.teacherId)?.name;
      setDone(`${editing.sectionName}, ${days[editing.day - 1]} period ${editing.period}: ${subject} with ${teacher}.`);
      setEditing(null);
      await grid.reload();
    } catch (err) {
      setEditError(err.message);
    }
  };

  const clearSlot = async (slot, section) => {
    setError(null);
    setDone(null);
    try {
      await api.del(`/schedule/slot/${slot.id}`);
      setDone(`Cleared ${section.name}, ${days[slot.day_of_week - 1]} period ${slot.period_number}.`);
      if (editing?.sectionId === section.id) setEditing(null);
      await grid.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const note = canBuild
    ? 'Set how many periods a day, then tap any period to allocate a subject and teacher.'
    : user.role === 'teacher' ? 'Your own classes are highlighted.' : isStudent ? 'Your section, Monday to Saturday.' : 'Every section’s week.';

  return (
    <>
      <PageHead title="Schedule" note={note} />

      <div className="stack">
        {canCancel && (
          <div className="panel">
            <header>
              <h3>Cancelled classes</h3>
              <button className={cancelOpen ? 'quiet' : ''} onClick={() => setCancelOpen((v) => !v)}>
                {cancelOpen ? 'Close' : 'Cancel classes'}
              </button>
            </header>
            <CancellationList user={user} items={cancellations.data} onChanged={cancellations.reload} />
          </div>
        )}
        {isStudent && (cancellations.data || []).length > 0 && (
          <div className="panel">
            <header><h3>Cancelled classes ahead</h3></header>
            <CancellationList user={user} items={cancellations.data} />
          </div>
        )}
        {canCancel && cancelOpen && <CancelClasses user={user} onChanged={cancellations.reload} />}

        {!isStudent && (
          <div className="panel">
            <div className="body row">
              <Select label="Course" value={courseId} options={(courses.data || []).map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => { setCourseId(v); setSectionFilter(''); setEditing(null); }} />
              <Select label="Section" value={sectionFilter} placeholder="All sections"
                options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))} onChange={setSectionFilter} />
            </div>
            {canBuild && courseId && grid.data && (
              <WeekSettings courseId={courseId} grid={grid.data}
                onSaved={async (res) => {
                  setDone(`${res.name} now runs Monday to ${DAY_NAMES[res.daysPerWeek - 1]}, ${res.periodsPerDay} ${res.periodsPerDay === 1 ? 'period' : 'periods'} a day.`);
                  await Promise.all([grid.reload(), courses.reload()]);
                }}
                onError={setError} />
            )}
          </div>
        )}

        {error && <Problem>{error}</Problem>}
        {done && <Done>{done}</Done>}
        {!isStudent && !courseId && (courses.data || []).length > 0 && <Empty>Pick a course to see its timetable.</Empty>}
        {!isStudent && !courses.loading && (courses.data || []).length === 0 && (
          <Empty action={canBuild ? <Link to="/setup">Add a course in Setup</Link> : null}>No courses have been set up yet.</Empty>
        )}
        {grid.loading && <Loading what="Loading timetable" />}
        {grid.error && <Problem>{grid.error}</Problem>}

        {canBuild && courseId && !sections.loading && (sections.data || []).length === 0 && (
          <Empty action={<Link to="/setup">Add sections in Setup</Link>}>
            This course has no sections yet. A timetable belongs to a section, so add one first.
          </Empty>
        )}
        {canBuild && courseId && !subjects.loading && (sections.data || []).length > 0 && (subjects.data || []).length === 0 && (
          <div className="notice">Each period teaches a subject, and this course has none yet. <Link to="/setup">Add subjects in Setup</Link>.</div>
        )}
        {canBuild && courseId && !teachers.loading && (teachers.data || []).length === 0 && (
          <div className="notice">Each period needs a teacher, and there are no teacher accounts yet. <Link to="/setup">Create them in Setup</Link>.</div>
        )}

        {!grid.loading && grid.data && sectionsInGrid.map((section) => {
          const own = slots.filter((s) => s.section_id === section.id);
          return (
            <div className="panel" key={section.id}>
              <header>
                <h3>{section.name}</h3>
                <span className="label">{own.length} of {days.length * periods.length} periods allocated</span>
              </header>
              {own.length === 0 && (
                <p className="label" style={{ padding: 'var(--s-3) var(--s-4) 0', margin: 0 }}>
                  {canBuild
                    ? 'Nothing allocated yet. Tap add in any period to give it a subject and a teacher.'
                    : 'No classes have been allocated to this section yet.'}
                </p>
              )}
              <div className="body scroll-x">
                <table className="timetable">
                  <thead>
                    <tr>
                      <th />
                      {periods.map((p) => (
                        <Fragment key={p}>
                          <th className="label">P{p}{timings?.periods?.[p - 1] && <small>{timings.periods[p - 1]}</small>}</th>
                          {p === breakAfter && <th className="label break">Break{timings.breakTime && <small> {timings.breakTime}</small>}</th>}
                        </Fragment>
                      ))}
                      {afterHours && <th className="label">{afterHours.afterHoursTime || 'After classes'}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((dayName, i) => {
                      const day = i + 1;
                      return (
                        <tr key={day}>
                          <th className="label">{dayName.slice(0, 3)}</th>
                          {periods.map((period) => {
                            const slot = cell(section.id, day, period);
                            const isEditing = editing?.sectionId === section.id && editing.day === day && editing.period === period;
                            const breakCell = period === breakAfter
                              ? <td className="break">Break</td> : null;
                            if (!slot) {
                              return (
                                <Fragment key={period}>
                                <td className={`empty${isEditing ? ' editing' : ''}`}>
                                  {canBuild && (
                                    <button className="link" onClick={() => open(section, day, period)}
                                      aria-label={`Add a class to ${section.name}, ${dayName}, period ${period}`}>
                                      add
                                    </button>
                                  )}
                                </td>
                                {breakCell}
                                </Fragment>
                              );
                            }
                            return (
                              <Fragment key={period}>
                              <td className={`${slot.mine ? 'mine' : ''}${isEditing ? ' editing' : ''}`}>
                                {slot.subject_name}
                                <small>{slot.teacher_name}</small>
                                {canBuild && (
                                  <span className="cell-actions">
                                    <button className="link" onClick={() => open(section, day, period, slot)}
                                      aria-label={`Change ${section.name}, ${dayName}, period ${period}`}>change</button>
                                    <button className="link" onClick={() => clearSlot(slot, section)}
                                      aria-label={`Clear ${section.name}, ${dayName}, period ${period}`}>clear</button>
                                  </span>
                                )}
                              </td>
                              {breakCell}
                              </Fragment>
                            );
                          })}
                          {afterHours && <td className="after-hours">{afterHours.afterHours[day] || ''}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {editing?.sectionId === section.id && (
                <SlotEditor
                  editing={editing}
                  days={days}
                  slots={slots}
                  subjects={subjects.data || []}
                  teachers={teachers.data || []}
                  error={editError}
                  onChange={(patch) => setEditing((e) => ({ ...e, ...patch }))}
                  onSave={saveSlot}
                  onCancel={() => { setEditing(null); setEditError(null); }}
                />
              )}

              {!isStudent && own.length > 0 && <Allocation slots={own} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Form state from what the grid says the week is. */
const weekForm = (g) => ({
  days: String(g.daysPerWeek ?? 6),
  periods: String(g.periodsPerDay ?? 8),
  times: periodList(12).map((p) => g.timings?.periods?.[p - 1] || ''),
  breakAfter: g.timings?.breakAfter ? String(g.timings.breakAfter) : '',
  breakTime: g.timings?.breakTime || '',
  afterHoursTime: g.timings?.afterHoursTime || '',
  afterHours: Object.fromEntries(periodList(6).map((d) => [d, g.timings?.afterHours?.[d] || ''])),
});

/**
 * The shape of the course's week: Monday to which day, how many periods, and,
 * optionally, the times printed on its routine. The grid, the register, the
 * cancellation form and the event form all follow it.
 */
function WeekSettings({ courseId, grid, onSaved, onError }) {
  const [form, setForm] = useState(() => weekForm(grid));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(weekForm(grid)), [grid]);

  const periods = Number(form.periods);
  const days = Number(form.days);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await api.put(`/schedule/course/${courseId}/settings`, {
        periodsPerDay: periods,
        daysPerWeek: days,
        timings: {
          periods: form.times.slice(0, periods),
          breakAfter: form.breakAfter && Number(form.breakAfter) < periods ? Number(form.breakAfter) : null,
          breakTime: form.breakTime || null,
          afterHoursTime: form.afterHoursTime || null,
          afterHours: Object.fromEntries(Object.entries(form.afterHours)
            .filter(([d, text]) => Number(d) <= days && text.trim())),
        },
      });
      await onSaved(res);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="body week-settings">
      <div className="row">
        <label className="field">
          Days a week
          <select value={form.days} onChange={(e) => set({ days: e.target.value })}>
            {periodList(6).map((n) => <option key={n} value={n}>Monday–{DAY_NAMES[n - 1]}</option>)}
          </select>
        </label>
        <label className="field">
          Periods a day
          <select value={form.periods} onChange={(e) => set({ periods: e.target.value })}>
            {periodList(12).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button className="quiet" onClick={() => setOpen((v) => !v)}>{open ? 'Hide timings' : 'Timings'}</button>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save week'}</button>
      </div>
      {open && (
        <div className="timings-editor stack" style={{ gap: '0.75rem', marginTop: '0.75rem' }}>
          <p className="label" style={{ margin: 0 }}>
            Optional. Whatever you type here is printed on the timetable exactly as written, like the routine on the notice board.
          </p>
          <div className="row">
            {periodList(periods).map((p) => (
              <label className="field" key={p}>
                Period {p}
                <input value={form.times[p - 1]} placeholder="10:15–11:15" style={{ width: '8.5rem' }}
                  onChange={(e) => set({ times: form.times.map((t, i) => (i === p - 1 ? e.target.value : t)) })} />
              </label>
            ))}
          </div>
          <div className="row">
            <label className="field">
              Break after
              <select value={form.breakAfter} onChange={(e) => set({ breakAfter: e.target.value })}>
                <option value="">No break shown</option>
                {periodList(Math.max(1, periods - 1)).filter((p) => p < periods).map((p) => <option key={p} value={p}>Period {p}</option>)}
              </select>
            </label>
            <label className="field">
              Break time
              <input value={form.breakTime} placeholder="1:25–2:15" onChange={(e) => set({ breakTime: e.target.value })} />
            </label>
            <label className="field">
              After classes, heading
              <input value={form.afterHoursTime} placeholder="After 3:15" onChange={(e) => set({ afterHoursTime: e.target.value })} />
            </label>
          </div>
          <div className="row">
            {periodList(days).map((d) => (
              <label className="field" key={d}>
                After classes on {DAY_NAMES[d - 1].slice(0, 3)}
                <input value={form.afterHours[d]} placeholder="Library hours" style={{ width: '15rem' }}
                  onChange={(e) => set({ afterHours: { ...form.afterHours, [d]: e.target.value } })} />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Allocating one period: a subject and a teacher, with anyone already busy then said so. */
function SlotEditor({ editing, days, slots, subjects, teachers, error, onChange, onSave, onCancel }) {
  // Teachers already in another section of this course at the same time.
  const busy = new Map(slots
    .filter((s) => s.day_of_week === editing.day && s.period_number === editing.period && s.section_id !== editing.sectionId)
    .map((s) => [s.teacher_id, s.section_name]));

  return (
    <div className="body editor" aria-live="polite">
      <h4>{editing.existing ? 'Change' : 'Allocate'} {editing.sectionName} · {days[editing.day - 1]} · period {editing.period}</h4>
      <div className="row">
        <Select label="Subject" value={editing.subjectId}
          options={subjects.map((s) => ({ value: s.id, label: s.code ? `${s.name} (${s.code})` : s.name }))}
          onChange={(v) => onChange({ subjectId: v })} />
        <Select label="Teacher" value={editing.teacherId}
          options={teachers.map((t) => ({
            value: t.id,
            label: `${t.name} (${t.login_id})${busy.has(t.id) ? ` — teaching ${busy.get(t.id)} then` : ''}`,
          }))}
          onChange={(v) => onChange({ teacherId: v })} />
        <button onClick={onSave} disabled={!editing.subjectId || !editing.teacherId}>Save period</button>
        <button className="quiet" onClick={onCancel}>Cancel</button>
      </div>
      {error && <Problem>{error}</Problem>}
    </div>
  );
}

/** How the section's week is allocated: classes per subject, and who teaches them. */
function Allocation({ slots }) {
  const rows = [...slots.reduce((map, s) => {
    const row = map.get(s.subject_name) || { subject: s.subject_name, count: 0, teachers: new Set() };
    row.count += 1;
    row.teachers.add(s.teacher_name);
    return map.set(s.subject_name, row);
  }, new Map()).values()].sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));

  return (
    <div className="body allocation">
      <table>
        <thead><tr><th>Subject</th><th className="num">Classes a week</th><th>Taught by</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subject}><td>{r.subject}</td><td className="num">{r.count}</td><td>{[...r.teachers].join(', ')}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
