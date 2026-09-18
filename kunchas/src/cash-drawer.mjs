import { verifyActor } from './pos-accountability.mjs';

const reply = (payload, status = 200) => Response.json(payload, { status, headers:{ 'cache-control':'no-store', 'x-content-type-options':'nosniff' } });
const text = (value) => String(value ?? '').trim().slice(0, 1000);

export async function recordCashDrawerOpen(request, env) {
  const body = await request.clone().json();
  const branchId = text(body.branchId || request.headers.get('x-branch-id')).slice(0, 500);
  const source = text(body.source);
  if (!branchId) return reply({ error:'Choose a branch before opening the cash drawer.' }, 400);
  if (!['checkout', 'daily_closing'].includes(source)) return reply({ error:'Choose a valid cash drawer reason source.' }, 400);

  let saleId = null;
  let actor = null;
  let reason = '';
  if (source === 'checkout') {
    saleId = text(body.saleId).slice(0, 500);
    const sale = saleId ? await env.DB.prepare('SELECT branch_id,cash_cents,recorded_by_id,recorded_by_name FROM sales WHERE id=?').bind(saleId).first() : null;
    if (!sale || sale.branch_id !== branchId || Number(sale.cash_cents || 0) <= 0) return reply({ error:'Open the drawer from a completed cash sale.' }, 400);
    if (!sale.recorded_by_id) return reply({ error:'The cash sale does not have a recorded staff member.' }, 400);
    actor = { id:text(sale.recorded_by_id), name:text(sale.recorded_by_name) || 'Recorded staff' };
    reason = 'Cash payment';
  } else {
    const auth = await verifyActor(request, env, branchId, false, false);
    if (auth.response) return auth.response;
    actor = auth.actor;
  }

  const openedAt = new Date().toISOString();
  const record = {
    id:'drawer-' + crypto.randomUUID(),
    opened_at:openedAt,
    branch_id:branchId,
    actor_id:actor.id,
    actor_name:actor.name,
    source,
    reason,
    sale_id:saleId
  };
  await env.DB.prepare('INSERT INTO cash_drawer_opens(id,opened_at,branch_id,actor_id,actor_name,source,reason,sale_id) VALUES (?,?,?,?,?,?,?,?)')
    .bind(record.id, record.opened_at, record.branch_id, record.actor_id, record.actor_name, record.source, record.reason, record.sale_id)
    .run();
  return reply({ ok:true, record });
}
