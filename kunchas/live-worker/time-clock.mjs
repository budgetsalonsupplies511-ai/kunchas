const dateInSydney = (value) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

// Cron triggers run in UTC, so calculate the first Sydney midnight after each shift.
export function nextSydneyMidnight(value) {
  const [year, month, day] = dateInSydney(value).split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney', timeZoneName: 'shortOffset'
  }).formatToParts(nextDay);
  const offset = parts.find(part => part.type === 'timeZoneName')?.value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!offset) throw new Error('Unable to determine Sydney midnight.');
  const minutes = (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] || 0));
  return new Date(Date.UTC(year, month - 1, day + 1) - minutes * 60000);
}

export async function closeStaleTimeEntries(env, now = new Date()) {
  const entries = (await env.DB.prepare('SELECT id, clock_in, break_started_at, break_minutes FROM time_entries WHERE clock_out IS NULL').all()).results || [];
  let closed = 0;
  for (const entry of entries) {
    const midnight = nextSydneyMidnight(entry.clock_in);
    if (midnight > now) continue;
    const addedBreak = entry.break_started_at && new Date(entry.break_started_at) < midnight
      ? Math.max(1, Math.round((midnight - new Date(entry.break_started_at)) / 60000)) : 0;
    await env.DB.prepare('UPDATE time_entries SET clock_out = ?, break_started_at = NULL, break_minutes = ? WHERE id = ? AND clock_out IS NULL')
      .bind(midnight.toISOString(), Number(entry.break_minutes || 0) + addedBreak, entry.id).run();
    closed++;
  }
  return closed;
}
