import { BOOKING_RULES, minutesOf, dateRange, validDate, branchWindow, availableSlots } from './booking-schedule.mjs';
import { publicBookingPage } from './public-booking-ui.mjs';
const text=v=>typeof v==='string'?v.trim():'';
const rows=async(env,sql,args=[])=> (await env.DB.prepare(sql).bind(...args).all()).results||[];
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
class BookingError extends Error { constructor(message,status=400){super(message);this.status=status;} }
async function selection(env,input) {
  const branchId=text(input.branchId),date=text(input.date),ids=input.serviceIds;
  if(!branchId||!validDate(date))throw new BookingError('Choose a branch and a valid date.');
  const range=dateRange();
  if(date<range.min||date>range.max)throw new BookingError('Choose a date from today up to 180 days ahead.');
  if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>typeof id!=='string'||id.length>100)||new Set(ids).size!==ids.length)throw new BookingError('Select between 1 and 20 different services.');
  const services=await rows(env,`SELECT id,name,duration_minutes,price_cents FROM services WHERE status='Active' AND id IN (${ids.map(()=>'?').join(',')})`,ids);
  if(services.length!==ids.length||services.some(s=>!Number.isInteger(s.duration_minutes)||s.duration_minutes<=0||s.price_cents<0))throw new BookingError('A selected service is unavailable. Please choose your services again.');
  const duration=services.reduce((sum,s)=>sum+s.duration_minutes,0),total=services.reduce((sum,s)=>sum+s.price_cents,0);
  const [window,bookings]=await Promise.all([branchWindow(env,branchId,date),rows(env,"SELECT id,booking_time,duration_minutes,status FROM bookings WHERE branch_id=? AND booking_date=? AND status NOT IN ('Cancelled','No show')",[branchId,date])]);
  return {branchId,date,ids,services,duration,total,slots:availableSlots(bookings,date,duration,window),closed:!window};
}
async function boundedJson(request) {
  if(!(request.headers.get('content-type')||'').includes('application/json'))throw new BookingError('Send JSON.',415);
  const reader=request.body?.getReader();if(!reader)throw new BookingError('Booking details are required.');
  const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw new BookingError('Booking details are too large.',413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try { const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body; } catch { throw new BookingError('Invalid booking details.'); }
}
async function confirmation(env,id) {
  return env.DB.prepare('SELECT b.id AS bookingId,b.booking_date AS date,b.booking_time AS time,b.duration_minutes AS durationMinutes,b.total_cents AS totalCents,b.service_names AS services,br.name AS branchName,br.address,br.phone FROM bookings b JOIN branches br ON br.id=b.branch_id WHERE b.id=?').bind(id).first();
}
async function submit(request,env,url) {
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new BookingError('Please book using our booking page.',403);
  const body=await boundedJson(request);
  if(text(body.website))throw new BookingError('Unable to submit this booking.');
  const id=text(body.requestId);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new BookingError('Please refresh the page and try again.');
  const customer=body.customer||{},firstName=text(customer.firstName),lastName=text(customer.lastName),email=text(customer.email).toLowerCase(),phone=text(customer.phone),notes=text(body.notes);
  if(!firstName||!lastName||firstName.length>80||lastName.length>80||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!/^\+?[\d\s()-]{8,25}$/.test(phone)||notes.length>1000)throw new BookingError('Enter your first and last name, valid email address and phone number. Notes must be under 1,000 characters.');
  const fingerprint=await hash(JSON.stringify({branchId:body.branchId,date:body.date,time:body.time,serviceIds:body.serviceIds,firstName,lastName,email,phone,notes}));
  const previous=await env.DB.prepare('SELECT fingerprint FROM public_booking_requests WHERE booking_id=?').bind(id).first();
  if(previous){if(previous.fingerprint!==fingerprint)throw new BookingError('This request has already been used. Refresh to make a new booking.',409);return json({ok:true,booking:await confirmation(env,id)});}
  const ip=request.headers.get('cf-connecting-ip')||'local',nowSeconds=Math.floor(Date.now()/1000),key='public-booking:'+await hash(ip);
  const rate=await env.DB.prepare(`INSERT INTO access_login_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts`).bind(key,nowSeconds+900,nowSeconds,nowSeconds).first();
  if(rate.attempts>20)throw new BookingError('Too many booking attempts. Please try again in 15 minutes or call the branch.',429);
  const chosen=await selection(env,body),time=text(body.time);
  if(!chosen.slots.includes(time)||!Number.isFinite(minutesOf(time)))throw new BookingError('This time is no longer available. Please choose another time.',409);
  const now=new Date().toISOString();
  // Never overwrite an existing customer's identity or branch from an unauthenticated form.
  // Contact details supplied for this appointment are retained in its private staff notes.
  const bookingNotes=['Online contact: '+firstName+' '+lastName+' | '+email+' | '+phone,notes].filter(Boolean).join('\n');
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO customers(id,created_at,updated_at,first_name,last_name,email,phone,branch_id,tags,notes) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING').bind(crypto.randomUUID(),now,now,firstName,lastName,email,phone,chosen.branchId,'Online booking',''),
      env.DB.prepare(`INSERT INTO bookings(id,created_at,updated_at,customer_id,branch_id,staff_id,service_ids,service_names,booking_date,booking_time,duration_minutes,total_cents,status,payment_status,notes,source) VALUES (?,?,?,(SELECT id FROM customers WHERE email=?),?,NULL,?,?,?,?,?,?,'Booked','Pay at store',?,'Online')`).bind(id,now,now,email,chosen.branchId,JSON.stringify(chosen.ids),chosen.services.map(s=>s.name).join(', '),chosen.date,time,chosen.duration,chosen.total,bookingNotes),
      env.DB.prepare('INSERT INTO public_booking_requests(booking_id,fingerprint) VALUES (?,?)').bind(id,fingerprint)
    ]);
  } catch(error) {
    const retry=await env.DB.prepare('SELECT fingerprint FROM public_booking_requests WHERE booking_id=?').bind(id).first();
    if(retry?.fingerprint!==fingerprint){if(String(error.message).includes('BOOKING_CAPACITY'))throw new BookingError('This time just filled up. Please choose another time.',409);throw error;}
  }
  return json({ok:true,booking:await confirmation(env,id)},201);
}
export async function publicBookingRoute(request,env) {
  const url=new URL(request.url),p=url.pathname;
  const page=p==='/book'||p==='/book/';
  if(!page&&!['/api/public-booking/catalog','/api/public-booking/availability','/api/public-booking/reserve'].includes(p))return null;
  try {
    if(page&&request.method==='GET')return new Response(publicBookingPage(),{headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://kunchas.com.au https://www.kunchas.com.au http://localhost:* http://127.0.0.1:*"}});
    if(p.endsWith('/catalog')&&request.method==='GET') {
      const [branches,services]=await Promise.all([rows(env,"SELECT id,name,address,phone FROM branches WHERE status='Open' ORDER BY name"),rows(env,`SELECT s.id,s.name,s.category,s.sub_category,s.duration_minutes,s.price_cents,COALESCE(o.pinned,CASE WHEN lower(trim(s.category)) LIKE '%special%' THEN 1 ELSE 0 END) AS category_pinned,COALESCE(o.sort_order,2147483647) AS category_sort_order
        FROM services s LEFT JOIN service_category_order o ON o.category=s.category
        WHERE s.status='Active' AND s.duration_minutes>0
        ORDER BY category_pinned DESC,category_sort_order,s.category,s.sub_category,s.name`)]);
      return json({branches,services,rules:BOOKING_RULES,dateRange:dateRange()});
    }
    if(p.endsWith('/availability')&&request.method==='GET') {
      const chosen=await selection(env,{branchId:url.searchParams.get('branchId'),date:url.searchParams.get('date'),serviceIds:url.searchParams.getAll('serviceId')});
      return json({slots:chosen.slots,durationMinutes:chosen.duration,totalCents:chosen.total,closed:chosen.closed,timeZone:BOOKING_RULES.timeZone});
    }
    if(p.endsWith('/reserve')&&request.method==='POST')return await submit(request,env,url);
    return json({error:'Method not allowed.'},405);
  } catch(error) {
    if(error instanceof BookingError)return json({error:error.message},error.status);
    console.error(JSON.stringify({event:'public_booking_failed',message:error.message}));
    return json({error:'Unable to complete your request. Please try again or call the branch.'},500);
  }
}
