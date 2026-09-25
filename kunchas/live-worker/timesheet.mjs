const dateParts = value => Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
  timeZone:'Australia/Sydney', year:'numeric', month:'2-digit', day:'2-digit'
}).formatToParts(new Date(value)).map(part => [part.type, part.value]));

export function sydneyDateKey(value) {
  const parts = dateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function nextCalendarDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function sydneyDayStartUtc(dateKey) {
  if (!validCalendarDate(dateKey)) throw new Error('Choose a valid date.');
  const [year, month, day] = dateKey.split('-').map(Number);
  // At 12:00 UTC on the previous date, Sydney is still before this midnight.
  const beforeMidnight = new Date(Date.UTC(year, month - 1, day - 1, 12));
  const zone = new Intl.DateTimeFormat('en-US', {
    timeZone:'Australia/Sydney', timeZoneName:'shortOffset'
  }).formatToParts(beforeMidnight).find(part => part.type === 'timeZoneName')?.value;
  const offset = zone?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!offset) throw new Error('Unable to determine Sydney time.');
  const minutes = (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3] || 0));
  return new Date(Date.UTC(year, month - 1, day) - minutes * 60000).toISOString();
}
