/**
 * Percentage convention used everywhere in this app:
 *   conducted  = present + absent + leave   (classes actually held)
 *   percentage = present / (present + absent)
 * Approved leave is condoned: it leaves the denominator, so a student is never
 * punished for a leave the college approved (spec rule 4).
 */
export function percentage({ present_count = 0, absent_count = 0 }) {
  const base = present_count + absent_count;
  if (base === 0) return null;
  return Math.round((present_count / base) * 10000) / 100;
}

export function rollup(rows) {
  const totals = rows.reduce(
    (acc, r) => ({
      conducted: acc.conducted + r.conducted,
      present_count: acc.present_count + r.present_count,
      absent_count: acc.absent_count + r.absent_count,
      leave_count: acc.leave_count + r.leave_count,
    }),
    { conducted: 0, present_count: 0, absent_count: 0, leave_count: 0 },
  );
  return { ...totals, percentage: percentage(totals) };
}

/**
 * How many more classes must be attended, in a row, to reach `minimum`.
 * Deliberately one-directional: it never tells a student how many they can skip.
 */
export function classesNeeded({ present_count = 0, absent_count = 0 }, minimum) {
  const base = present_count + absent_count;
  const current = percentage({ present_count, absent_count });
  if (minimum >= 100) return { needed: null, current, unreachable: true };
  if (current !== null && current >= minimum) return { needed: 0, current, unreachable: false };
  // solve (P + n) / (base + n) >= m/100  for the smallest integer n
  const m = minimum / 100;
  const needed = Math.ceil((m * base - present_count) / (1 - m));
  return { needed: Math.max(0, needed), current, unreachable: false };
}
