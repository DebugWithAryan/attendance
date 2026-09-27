import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { Empty, Loading, PageHead, Problem, Select } from '../components/Bits.jsx';

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * One grid for everyone. A teacher's own classes are solid ink; everything else
 * is muted, so a timetable scan takes a second rather than a minute.
 */
export default function Schedule() {
  const { user } = useAuth();
  const isStudent = user.role === 'student';
  const [courseId, setCourseId] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);

  const courses = useApi(isStudent ? null : '/courses', { skip: isStudent });
  const sections = useApi(courseId ? `/sections?courseId=${courseId}` : null, { skip: !courseId });
  const subjects = useApi(courseId ? `/subjects?courseId=${courseId}` : null, { skip: !courseId });
  const teachers = useApi(user.role === 'hod' ? '/users?role=teacher' : null, { skip: user.role !== 'hod' });
  const grid = useApi(isStudent ? '/schedule/mine' : (courseId ? `/schedule/course/${courseId}` : null), { skip: !isStudent && !courseId });

  const slots = grid.data?.slots || [];
  const days = grid.data?.days || [];
  const sectionsInGrid = isStudent
    ? [{ id: 'mine', name: grid.data?.section }]
    : (sections.data || []).filter((s) => !sectionFilter || s.id === sectionFilter);

  const cell = (sectionId, day, period) => slots.find((s) =>
    (isStudent || s.section_id === sectionId) && s.day_of_week === day && s.period_number === period);

  const saveSlot = async () => {
    setError(null);
    try {
      await api.put('/schedule/slot', {
        courseId,
        sectionId: draft.sectionId,
        dayOfWeek: draft.day,
        periodNumber: draft.period,
        subjectId: draft.subjectId,
        teacherId: draft.teacherId,
      });
      setDraft(null);
      await grid.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const clearSlot = async (id) => {
    setError(null);
    try {
      await api.del(`/schedule/slot/${id}`);
      await grid.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead
        title="Schedule"
        note={user.role === 'hod' ? 'Six days a week. Click a period to fill or change it.'
          : user.role === 'teacher' ? 'Your own classes are highlighted.' : 'Your section, Monday to Saturday.'}
      />

      <div className="stack">
        {!isStudent && (
          <div className="panel">
            <div className="body row">
              <Select label="Course" value={courseId} options={(courses.data || []).map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => { setCourseId(v); setSectionFilter(''); }} />
              <Select label="Section" value={sectionFilter} placeholder="All sections"
                options={(sections.data || []).map((s) => ({ value: s.id, label: s.name }))} onChange={setSectionFilter} />
            </div>
          </div>
        )}

        {error && <Problem>{error}</Problem>}
        {!isStudent && !courseId && <Empty>Pick a course to see its timetable.</Empty>}
        {grid.loading && <Loading what="Loading timetable" />}

        {slots.length === 0 && !grid.loading && (isStudent || courseId) && <Empty>No periods have been set up yet.</Empty>}

        {sectionsInGrid.map((section) => (
          slots.some((s) => isStudent || s.section_id === section.id) && (
            <div className="panel" key={section.id}>
              <header><h3>{section.name}</h3></header>
              <div className="body scroll-x">
                <table className="timetable">
                  <thead>
                    <tr>
                      <th />
                      {PERIODS.map((p) => <th key={p} className="label">P{p}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((dayName, i) => {
                      const day = i + 1;
                      return (
                        <tr key={day}>
                          <th className="label">{dayName.slice(0, 3)}</th>
                          {PERIODS.map((period) => {
                            const slot = cell(section.id, day, period);
                            if (!slot) {
                              return (
                                <td key={period} className="empty">
                                  {user.role === 'hod' && (
                                    <button className="link"
                                      onClick={() => setDraft({ sectionId: section.id, day, period, subjectId: '', teacherId: '' })}>
                                      add
                                    </button>
                                  )}
                                </td>
                              );
                            }
                            return (
                              <td key={period} className={slot.mine ? 'mine' : ''}>
                                {slot.subject_name}
                                <small>{slot.teacher_name}</small>
                                {user.role === 'hod' && (
                                  <button className="link" style={{ color: 'inherit' }} onClick={() => clearSlot(slot.id)}>clear</button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ))}

        {draft && (
          <div className="panel">
            <header><h3>Day {draft.day}, period {draft.period}</h3></header>
            <div className="body row">
              <Select label="Subject" value={draft.subjectId} options={(subjects.data || []).map((s) => ({ value: s.id, label: s.name }))}
                onChange={(v) => setDraft((d) => ({ ...d, subjectId: v }))} />
              <Select label="Teacher" value={draft.teacherId}
                options={(teachers.data || []).map((t) => ({ value: t.id, label: `${t.name} (${t.login_id})` }))}
                onChange={(v) => setDraft((d) => ({ ...d, teacherId: v }))} />
              <button onClick={saveSlot} disabled={!draft.subjectId || !draft.teacherId}>Save period</button>
              <button className="quiet" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
