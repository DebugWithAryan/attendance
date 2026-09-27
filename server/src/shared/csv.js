const escape = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Streams-free but allocation-light: one join over the rows already in hand. */
export function toCsv(columns, rows) {
  const head = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(c.get(row))).join(',')).join('\n');
  return `${head}\n${body}\n`;
}
