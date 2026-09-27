/**
 * Percentage convention used everywhere in this app:
 *   not_marked = classes held for the student's section (the register was
 *                taken) where the student has no mark at all
 *   conducted  = present + absent + leave + not_marked   (classes held for them)
 *   percentage = present / (present + absent + not_marked)
 *
 * Attendance is measured against the classes the college actually held, not
 * against whichever rows happen to exist for one student: a class that ran
 * without the student being marked still ran. Approved leave is condoned: it
 * leaves the denominator, so a student is never punished for a leave the
 * college approved (spec rule 4). Cancelled classes were never held, so they
 * appear nowhere.
 */
const counted = ({ present_count = 0, absent_count = 0, not_marked = 0 }) =>
  present_count + absent_count + not_marked;

export function percentage(stats) {
  const base = counted(stats);
  if (base === 0) return null;
  return Math.round(((stats.present_count || 0) / base) * 10000) / 100;
}

export function rollup(rows) {
  const totals = rows.reduce(
    (acc, r) => ({
      conducted: acc.conducted + (r.conducted || 0),
      present_count: acc.present_count + (r.present_count || 0),
      absent_count: acc.absent_count + (r.absent_count || 0),
      leave_count: acc.leave_count + (r.leave_count || 0),
      not_marked: acc.not_marked + (r.not_marked || 0),
    }),
    { conducted: 0, present_count: 0, absent_count: 0, leave_count: 0, not_marked: 0 },
  );
  return { ...totals, percentage: percentage(totals) };
}

/**
 * How many more classes must be attended, in a row, to reach `minimum`.
 * Deliberately one-directional: it never tells a student how many they can skip.
 */
export function classesNeeded(stats, minimum) {
  const present = stats.present_count || 0;
  const base = counted(stats);
  const current = percentage(stats);
  if (minimum >= 100) return { needed: null, current, unreachable: true };
  if (current !== null && current >= minimum) return { needed: 0, current, unreachable: false };
  // solve (P + n) / (base + n) >= m/100  for the smallest integer n
  const m = minimum / 100;
  const needed = Math.ceil((m * base - present) / (1 - m) - 1e-9);
  return { needed: Math.max(0, needed), current, unreachable: false };
}

/**
 * The attendance badge: recognition for students at or above `threshold`.
 * A student below it is told how many classes in a row would earn it, which
 * is the motivating half of the feature.
 */
export function badgeFor(stats, threshold) {
  const current = percentage(stats);
  const earned = current !== null && current >= threshold;
  const { needed } = classesNeeded(stats, threshold);
  return { earned, threshold, current, needed: earned ? 0 : needed };
}
