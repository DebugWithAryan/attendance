/**
 * For documentation screenshots only. Moves this process's clock to
 * MANUAL_DATE (YYYY-MM-DD) at the current time of day, so the manual can show
 * a teacher's weekday even when it is generated on a Sunday.
 *
 *   MANUAL_DATE=2026-09-28 node --import ./scripts/manual/clock.mjs scripts/vercel-sim.mjs
 *
 * Without MANUAL_DATE it does nothing. Never load it in a deployment.
 */
const target = process.env.MANUAL_DATE;

export const shiftSource = (date) => `(() => {
  const RealDate = Date;
  const now = new RealDate();
  const offset = new RealDate('${date}T' + now.toISOString().slice(11)).getTime() - now.getTime();
  class ManualDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(RealDate.now() + offset); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = ManualDate;
})();`;

if (target) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('MANUAL_DATE must be YYYY-MM-DD');
  // eslint-disable-next-line no-eval
  (0, eval)(shiftSource(target));
}
