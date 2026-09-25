export function normalizeCustomerPhone(value) {
  const digits = String(value ?? '').replace(/[ ()+.\-\t\n\r]/g, '');
  if (/^0061\d{9}$/.test(digits)) return '0' + digits.slice(4);
  if (/^61\d{9}$/.test(digits)) return '0' + digits.slice(2);
  return digits;
}

export class DuplicatePhoneError extends Error {
  constructor(customer) {
    super('Duplicate number (' + [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() + ')');
    this.name = 'DuplicatePhoneError';
  }
}

export async function findPhoneOwner(env, phone, excludeId = '') {
  const key = normalizeCustomerPhone(phone);
  if (!key) return null;
  return env.DB.prepare('SELECT id,first_name,last_name,email,branch_id FROM customers WHERE phone_key=? AND id!=? ORDER BY created_at,id LIMIT 1').bind(key, excludeId).first();
}

export async function assertUniqueCustomerPhone(env, phone, excludeId = '') {
  const owner = await findPhoneOwner(env, phone, excludeId);
  if (owner) throw new DuplicatePhoneError(owner);
}

export async function phoneCheckResponse(url, env) {
  const owner = await findPhoneOwner(env, url.searchParams.get('checkPhone'), url.searchParams.get('excludeCustomerId') || '');
  return Response.json({ duplicate: Boolean(owner), message: owner ? new DuplicatePhoneError(owner).message : '' }, { headers: { 'cache-control': 'no-store' } });
}
