export const BOOKING_RULES = Object.freeze({ interval:15, capacity:4, start:600, end:1140, timeZone:'Australia/Sydney', advanceDays:180 });
export const minutesOf = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time)) ? Number(time.slice(0,2))*60+Number(time.slice(3)) : NaN;
export const timeOf = minutes => String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
export function validDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date; }
export function salonNow(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:BOOKING_RULES.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,minutes:Number(parts.hour)*60+Number(parts.minute)};
}
export function dateRange(now=new Date()) { const {date}=salonNow(now); return {min:date,max:new Date(Date.parse(date+'T00:00:00Z')+BOOKING_RULES.advanceDays*86400000).toISOString().slice(0,10)}; }
export function isAtCapacity(bookings,start,end,exclude='') {
  const active=bookings.filter(b=>b.id!==exclude&&!['Cancelled','No show'].includes(b.status)).map(b=>({start:minutesOf(b.booking_time),end:minutesOf(b.booking_time)+Math.max(15,Number(b.duration_minutes)||15)})).filter(b=>b.start<end&&b.end>start);
  return [start,...active.map(b=>Math.max(start,b.start))].some(point=>active.filter(b=>b.start<=point&&point<b.end).length>=BOOKING_RULES.capacity);
}
export async function branchWindow(env,branchId,date) {
  if(!validDate(date))return null;
  const [branch,hours,closed]=await Promise.all([
    env.DB.prepare("SELECT id FROM branches WHERE id=? AND status='Open'").bind(branchId).first(),
    env.DB.prepare('SELECT * FROM branch_hours WHERE branch_id=? AND day_of_week=?').bind(branchId,new Date(date+'T12:00:00Z').getUTCDay()).first(),
    env.DB.prepare('SELECT id FROM branch_closed_dates WHERE branch_id=? AND closed_date=?').bind(branchId,date).first()
  ]);
  if(!branch||closed||hours?.is_closed)return null;
  const start=hours?Math.max(BOOKING_RULES.start,minutesOf(hours.open_time)):BOOKING_RULES.start;
  const end=hours?Math.min(BOOKING_RULES.end,minutesOf(hours.close_time)):BOOKING_RULES.end;
  return Number.isFinite(start)&&Number.isFinite(end)&&end>start?{start,end}:null;
}
export function availableSlots(bookings,date,duration,window,now=new Date()) {
  const current=salonNow(now),range=dateRange(now),slots=[];
  if(!window||!validDate(date)||date<range.min||date>range.max||!Number.isInteger(duration)||duration<=0)return slots;
  for(let start=Math.ceil(window.start/15)*15;start+duration<=window.end;start+=15) {
    if(date===current.date&&start<=current.minutes)continue;
    if(!isAtCapacity(bookings,start,start+duration))slots.push(timeOf(start));
  }
  return slots;
}
