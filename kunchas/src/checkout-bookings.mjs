import { salonNow } from './booking-schedule.mjs';
export async function checkoutBookings(request, env) {
  const url = new URL(request.url);
  const branchId = request.headers.get('x-branch-id') || url.searchParams.get('branchId') || '';
  if (!branchId) return Response.json({error:'Choose a branch.'},{status:400});
  const search = (url.searchParams.get('search') || '').trim().slice(0,120);
  const today = salonNow().date;
  const result = await env.DB.prepare(`SELECT b.*, c.first_name, c.last_name, c.email, c.phone,
    trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) AS customer_name
    FROM bookings b LEFT JOIN customers c ON c.id=b.customer_id
    WHERE b.branch_id=? AND coalesce(b.sale_id,'')='' AND coalesce(b.payment_status,'')!='Paid'
    AND b.status NOT IN ('Cancelled','No show')
    AND ((?='' AND b.booking_date=?) OR (?!='' AND
      lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'') || ' ' ||
      coalesce(c.email,'') || ' ' || coalesce(c.phone,'') || ' ' ||
      coalesce(b.service_names,'') || ' ' || b.booking_date || ' ' || b.id) LIKE ?))
    ORDER BY b.booking_date DESC,b.booking_time ASC LIMIT 101`)
    .bind(branchId,search,today,search,'%'+search.toLowerCase()+'%').all();
  const bookings=(result.results||[]).slice(0,100);
  const customers=bookings.filter(b=>b.customer_id).map(b=>({id:b.customer_id,first_name:b.first_name||'',last_name:b.last_name||'',email:b.email||'',phone:b.phone||''}));
  return Response.json({bookings,customers,hasMore:(result.results||[]).length>100},{headers:{'cache-control':'no-store'}});
}
