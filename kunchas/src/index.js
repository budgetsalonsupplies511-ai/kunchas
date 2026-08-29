export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
        return htmlResponse(renderApp("", "overview", "admin"));
      }

      if (request.method === "GET" && url.pathname === "/pos") {
        return htmlResponse(renderApp("", "pos", "staff"));
      }

      if (request.method === "GET" && url.pathname.startsWith("/pos/")) {
        return htmlResponse(renderApp(clean(url.pathname.replace("/pos/", "")), "pos", "staff"));
      }

      if (request.method === "GET" && url.pathname === "/bookings") {
        return htmlResponse(renderApp("", "bookings", "staff"));
      }

      if (request.method === "GET" && url.pathname.startsWith("/bookings/")) {
        return htmlResponse(renderApp(clean(url.pathname.replace("/bookings/", "")), "bookings", "staff"));
      }

      if (request.method === "GET" && url.pathname === "/api/branches-public") {
        return listPublicBranches(env);
      }

      if (request.method === "GET" && url.pathname === "/api/pos-data") {
        const auth = await authorizeBranch(request, env);
        if (auth) return auth;
        return getPosData(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/branch-bookings") {
        const auth = await authorizeBranch(request, env);
        if (auth) return auth;
        return createBranchBooking(request, env);
      }

      if (request.method === "PATCH" && url.pathname.startsWith("/api/bookings/")) {
        const auth = await authorizeBookingEdit(request, env);
        if (auth) return auth;
        return updateBooking(request, env, clean(url.pathname.replace("/api/bookings/", "")));
      }

      if (request.method === "POST" && url.pathname === "/api/sales") {
        const auth = await authorizeSale(request, env);
        if (auth) return auth;
        const response = await createSale(request, env);
        if (response.ok) ctx.waitUntil(logEvent("sale_created"));
        return response;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-closing") {
        const auth = await authorizeBranch(request, env);
        if (auth) return auth;
        return createDailyClosing(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/app-data") return getAppData(env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/daily-closing/")) return updateDailyClosing(request, env, clean(url.pathname.replace("/api/daily-closing/", "")));
      if (request.method === "POST" && url.pathname === "/api/customers") return createCustomer(request, env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/customers/")) return updateCustomer(request, env, clean(url.pathname.replace("/api/customers/", "")));
      if (request.method === "POST" && url.pathname === "/api/bookings") return createBooking(request, env);
      if (request.method === "POST" && url.pathname === "/api/services") return createService(request, env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/services/")) return updateService(request, env, clean(url.pathname.replace("/api/services/", "")));
      if (request.method === "POST" && url.pathname === "/api/products") return createProduct(request, env);
      if (request.method === "POST" && url.pathname === "/api/staff") return createStaff(request, env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/staff/")) return updateStaff(request, env, clean(url.pathname.replace("/api/staff/", "")));
      if (request.method === "POST" && url.pathname === "/api/staff-roster") return saveStaffRoster(request, env);
      if (request.method === "DELETE" && url.pathname === "/api/staff-roster") return deleteStaffRoster(request, env, url);
      if (request.method === "POST" && url.pathname === "/api/staff-regular-days-off") return saveStaffRegularDaysOff(request, env);
      if (request.method === "POST" && url.pathname === "/api/branches") return createBranch(request, env);
      if (request.method === "DELETE" && url.pathname.startsWith("/api/branches/")) return deleteBranch(request, env, clean(url.pathname.replace("/api/branches/", "")));
      if (request.method === "POST" && url.pathname === "/api/stock-movements") return createStockMovement(request, env);
      if (request.method === "POST" && url.pathname === "/api/branch-hours") return saveBranchHours(request, env);
      if (request.method === "POST" && url.pathname === "/api/closed-dates") return createClosedDate(request, env);
      if (request.method === "POST" && url.pathname === "/api/discounts") return createDiscount(request, env);

      return new Response("Not found", { status: 404 });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: error.message }));
      return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
    }
  }
};

async function getAppData(env) {
  const [branches, staff, services, products, customers, bookings, sales, saleItems, branchHours, closedDates, discounts, inventoryStock, stockMovements, dailyClosings, staffRoster, staffRegularDaysOff] = await Promise.all([
    all(env, "SELECT * FROM branches ORDER BY name"),
    all(env, "SELECT * FROM staff ORDER BY branch_id, name"),
    all(env, "SELECT * FROM services ORDER BY category, name"),
    all(env, "SELECT * FROM products ORDER BY category, name"),
    all(env, "SELECT * FROM customers ORDER BY created_at DESC LIMIT 200"),
    all(env, `SELECT b.*, c.first_name, c.last_name, br.name AS branch_name, s.name AS staff_name
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN branches br ON br.id = b.branch_id
      LEFT JOIN staff s ON s.id = b.staff_id
      ORDER BY b.booking_date DESC, b.booking_time DESC
      LIMIT 200`),
    all(env, `SELECT s.*, br.name AS branch_name
      FROM sales s
      LEFT JOIN branches br ON br.id = s.branch_id
      ORDER BY s.created_at DESC
      LIMIT 200`),
    all(env, `SELECT si.*, s.customer_id, s.created_at, s.branch_id, br.name AS branch_name
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN branches br ON br.id = s.branch_id
      ORDER BY s.created_at DESC
      LIMIT 1000`),
    all(env, "SELECT * FROM branch_hours ORDER BY branch_id, day_of_week"),
    all(env, "SELECT * FROM branch_closed_dates ORDER BY closed_date DESC LIMIT 200"),
    all(env, "SELECT * FROM discounts ORDER BY created_at DESC LIMIT 200"),
    all(env, `SELECT st.*, p.name AS product_name, p.sku, br.name AS branch_name
      FROM inventory_stock st
      LEFT JOIN products p ON p.id = st.product_id
      LEFT JOIN branches br ON br.id = st.branch_id
      ORDER BY br.name, p.name`),
    all(env, `SELECT sm.*, p.name AS product_name, br.name AS branch_name
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      LEFT JOIN branches br ON br.id = sm.branch_id
      ORDER BY sm.created_at DESC LIMIT 200`),
    all(env, `SELECT dc.*, br.name AS branch_name
      FROM daily_closings dc
      LEFT JOIN branches br ON br.id = dc.branch_id
      ORDER BY dc.closing_date DESC, br.name LIMIT 200`),
    all(env, `SELECT sr.*, br.name AS branch_name
      FROM staff_roster sr
      LEFT JOIN branches br ON br.id = sr.branch_id
      ORDER BY sr.roster_date, sr.staff_id LIMIT 2000`),
    all(env, "SELECT * FROM staff_regular_days_off ORDER BY staff_id, day_of_week")
  ]);

  return jsonResponse({
    branches,
    staff,
    services,
    products,
    customers,
    bookings: bookings.map((booking) => ({
      ...booking,
      customer_name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim()
    })),
    sales,
    saleItems,
    branchHours,
    closedDates,
    discounts,
    inventoryStock,
    stockMovements,
    dailyClosings,
    staffRoster,
    staffRegularDaysOff
  });
}

async function listPublicBranches(env) {
  const branches = await all(env, "SELECT id, name, address FROM branches WHERE status = 'Open' ORDER BY name");
  return jsonResponse({ branches });
}

async function getPosData(request, env) {
  const branchId = request.headers.get("x-branch-id");
  const [branch, staff, services, products, customers, bookings, sales, branchHours, closedDates, dailyClosings] = await Promise.all([
    all(env, "SELECT id, name, address, phone, post_code FROM branches WHERE id = ?", [branchId]),
    all(env, `SELECT st.*, br.name AS branch_name
      FROM staff st
      LEFT JOIN branches br ON br.id = st.branch_id
      WHERE st.status = 'Active'
      ORDER BY br.name, st.name`),
    all(env, "SELECT * FROM services WHERE status = 'Active' ORDER BY category, name"),
    all(env, "SELECT * FROM products WHERE status = 'Active' ORDER BY category, name"),
    all(env, "SELECT * FROM customers ORDER BY updated_at DESC LIMIT 500"),
    all(env, `SELECT b.*, c.first_name, c.last_name, br.name AS branch_name, s.name AS staff_name
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN branches br ON br.id = b.branch_id
      LEFT JOIN staff s ON s.id = b.staff_id
      WHERE b.branch_id = ?
      ORDER BY b.booking_date ASC, b.booking_time ASC
      LIMIT 200`, [branchId]),
    all(env, `SELECT s.*, br.name AS branch_name
      FROM sales s
      LEFT JOIN branches br ON br.id = s.branch_id
      WHERE s.branch_id = ?
      ORDER BY s.created_at DESC
      LIMIT 50`, [branchId]),
    all(env, "SELECT * FROM branch_hours WHERE branch_id = ? ORDER BY day_of_week", [branchId]),
    all(env, "SELECT * FROM branch_closed_dates WHERE branch_id = ? ORDER BY closed_date DESC LIMIT 100", [branchId]),
    all(env, `SELECT dc.*, br.name AS branch_name
      FROM daily_closings dc
      LEFT JOIN branches br ON br.id = dc.branch_id
      WHERE dc.branch_id = ?
      ORDER BY dc.closing_date DESC LIMIT 60`, [branchId])
  ]);

  return jsonResponse({
    branch: branch[0],
    branches: branch,
    staff,
    services,
    products,
    customers,
    bookings: bookings.map((booking) => ({
      ...booking,
      customer_name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim()
    })),
    sales,
    branchHours,
    closedDates,
    dailyClosings
  });
}

async function createCustomer(request, env) {
  const body = await request.json();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const firstName = clean(body.firstName);
  const lastName = clean(body.lastName);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const branchId = clean(body.branchId);

  if (!firstName || !lastName || !email || !phone || !branchId) {
    return jsonResponse({ error: "Customer name, email, phone, and branch are required." }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO customers (id, created_at, updated_at, first_name, last_name, email, phone, branch_id, tags, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
      updated_at = excluded.updated_at,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      phone = excluded.phone,
      branch_id = excluded.branch_id,
      tags = excluded.tags,
      notes = excluded.notes`
  )
    .bind(id, now, now, firstName, lastName, email, phone, branchId, clean(body.tags), clean(body.notes))
    .run();

  return jsonResponse({ ok: true });
}

async function createBooking(request, env) {
  const body = await request.json();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const branchId = clean(body.branchId);
  const customerId = clean(body.customerId) || await ensureBookingCustomer(env, body.customer || {}, branchId, "Online booking");
  const staffId = clean(body.staffId);
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.map(clean).filter(Boolean) : [];
  const bookingDate = clean(body.bookingDate);
  const bookingTime = clean(body.bookingTime);

  if (!customerId || !branchId || !bookingDate || !bookingTime || !serviceIds.length) {
    return jsonResponse({ error: "Customer, branch, date, time, and at least one service are required." }, 400);
  }

  const placeholders = serviceIds.map(() => "?").join(",");
  const serviceRows = await all(env, `SELECT id, name, duration_minutes, price_cents FROM services WHERE id IN (${placeholders})`, serviceIds);
  const totalMinutes = serviceRows.reduce((total, service) => total + Number(service.duration_minutes || 0), 0);
  const totalCents = serviceRows.reduce((total, service) => total + Number(service.price_cents || 0), 0);

  await env.DB.prepare(
    `INSERT INTO bookings (
      id, created_at, updated_at, customer_id, branch_id, staff_id, service_ids,
      service_names, booking_date, booking_time, duration_minutes, total_cents,
      status, payment_status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      now,
      now,
      customerId,
      branchId,
      staffId || null,
      JSON.stringify(serviceIds),
      serviceRows.map((service) => service.name).join(", "),
      bookingDate,
      bookingTime,
      totalMinutes,
      totalCents,
      "Booked",
      "Pay at store",
      clean(body.notes)
    )
    .run();

  return jsonResponse({ ok: true, bookingId: id });
}

async function ensureBookingCustomer(env, customer, branchId, tag) {
  const now = new Date().toISOString();
  const firstName = clean(customer.firstName);
  const lastName = clean(customer.lastName);
  const email = clean(customer.email).toLowerCase();
  const phone = clean(customer.phone);
  if (!firstName || !lastName || !branchId || (!email && !phone)) return "";

  const lookup = email
    ? await all(env, "SELECT id FROM customers WHERE email = ?", [email])
    : await all(env, "SELECT id FROM customers WHERE phone = ? LIMIT 1", [phone]);
  const id = lookup[0]?.id || crypto.randomUUID();
  const customerEmail = email || `${id}@phone.kunchas.local`;

  await env.DB.prepare(
    `INSERT INTO customers (id, created_at, updated_at, first_name, last_name, email, phone, branch_id, tags, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
      updated_at = excluded.updated_at,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      phone = excluded.phone,
      branch_id = excluded.branch_id,
      tags = excluded.tags`
  )
    .bind(id, now, now, firstName, lastName, customerEmail, phone || "Not supplied", branchId, tag, clean(customer.notes))
    .run();

  const rows = await all(env, "SELECT id FROM customers WHERE email = ?", [customerEmail]);
  return rows[0]?.id || id;
}

async function createBranchBooking(request, env) {
  const body = await request.json();
  const branchId = clean(request.headers.get("x-branch-id"));
  const customerId = await ensureBookingCustomer(env, body.customer || {}, branchId, "Manual booking");
  if (!customerId) return jsonResponse({ error: "Customer name and either phone or email are required." }, 400);
  const bookingRequest = new Request(request.url, {
    method: "POST",
    body: JSON.stringify({
      customerId,
      branchId,
      staffId: clean(body.staffId),
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds : [],
      bookingDate: clean(body.bookingDate),
      bookingTime: clean(body.bookingTime),
      notes: clean(body.notes)
    })
  });
  return createBooking(bookingRequest, env);
}

async function updateBooking(request, env, bookingId) {
  const body = await request.json();
  const existing = (await all(env, "SELECT * FROM bookings WHERE id = ?", [bookingId]))[0];
  if (!existing) return jsonResponse({ error: "Booking not found." }, 404);

  const serviceIds = Array.isArray(body.serviceIds) && body.serviceIds.length
    ? body.serviceIds.map(clean).filter(Boolean)
    : JSON.parse(existing.service_ids || "[]");
  const placeholders = serviceIds.map(() => "?").join(",");
  const serviceRows = serviceIds.length ? await all(env, `SELECT id, name, duration_minutes, price_cents FROM services WHERE id IN (${placeholders})`, serviceIds) : [];
  const totalMinutes = serviceRows.reduce((total, service) => total + Number(service.duration_minutes || 0), 0) || existing.duration_minutes;
  const totalCents = serviceRows.reduce((total, service) => total + Number(service.price_cents || 0), 0) || existing.total_cents;

  await env.DB.prepare(
    `UPDATE bookings SET
      updated_at = ?, staff_id = ?, service_ids = ?, service_names = ?,
      booking_date = ?, booking_time = ?, duration_minutes = ?, total_cents = ?,
      status = ?, notes = ?
     WHERE id = ?`
  )
    .bind(
      new Date().toISOString(),
      clean(body.staffId) || null,
      JSON.stringify(serviceIds),
      serviceRows.map((service) => service.name).join(", ") || existing.service_names,
      clean(body.bookingDate) || existing.booking_date,
      clean(body.bookingTime) || existing.booking_time,
      totalMinutes,
      totalCents,
      clean(body.status) || existing.status,
      clean(body.notes) || existing.notes,
      bookingId
    )
    .run();

  return jsonResponse({ ok: true });
}

async function createService(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  const category = clean(body.category) || "General";
  const duration = Number(body.durationMinutes || 0);
  const priceCents = Math.round(Number(body.price || 0) * 100);
  if (!name || !duration || !priceCents) return jsonResponse({ error: "Service name, duration, and price are required." }, 400);
  await env.DB.prepare("INSERT INTO services (id, name, category, duration_minutes, price_cents, status) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(`service-${crypto.randomUUID()}`, name, category, duration, priceCents, clean(body.status) || "Active")
    .run();
  return jsonResponse({ ok: true });
}

async function updateCustomer(request, env, customerId) {
  const body = await request.json();
  const firstName = clean(body.firstName);
  const lastName = clean(body.lastName);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const branchId = clean(body.branchId);
  if (!customerId || !firstName || !lastName || !email || !phone || !branchId) {
    return jsonResponse({ error: "Customer name, email, phone, and home branch are required." }, 400);
  }
  const result = await env.DB.prepare(`UPDATE customers SET updated_at = ?, first_name = ?, last_name = ?, email = ?, phone = ?, branch_id = ?, tags = ?, notes = ? WHERE id = ?`)
    .bind(new Date().toISOString(), firstName, lastName, email, phone, branchId, clean(body.tags), clean(body.notes), customerId)
    .run();
  if (!result.meta.changes) return jsonResponse({ error: "Customer not found." }, 404);
  return jsonResponse({ ok: true });
}

async function updateService(request, env, serviceId) {
  if (!serviceId) return jsonResponse({ error: "Service is required." }, 400);
  const body = await request.json();
  const name = clean(body.name);
  const category = clean(body.category) || "General";
  const duration = Number(body.durationMinutes || 0);
  const priceCents = Math.round(Number(body.price || 0) * 100);
  const status = clean(body.status) === "Inactive" ? "Inactive" : "Active";
  if (!name || !Number.isInteger(duration) || duration < 1 || !Number.isInteger(priceCents) || priceCents < 1) {
    return jsonResponse({ error: "Service name, duration, and price are required." }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM services WHERE id = ?").bind(serviceId).first();
  if (!existing) return jsonResponse({ error: "Service not found." }, 404);
  await env.DB.prepare("UPDATE services SET name = ?, category = ?, duration_minutes = ?, price_cents = ?, status = ? WHERE id = ?")
    .bind(name, category, duration, priceCents, status, serviceId)
    .run();
  return jsonResponse({ ok: true });
}

async function createProduct(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  const category = clean(body.category) || "Retail";
  const priceCents = Math.round(Number(body.price || 0) * 100);
  const costCents = Math.round(Number(body.cost || 0) * 100);
  if (!name || !priceCents) return jsonResponse({ error: "Product name and retail price are required." }, 400);
  await env.DB.prepare("INSERT INTO products (id, name, brand, category, sku, barcode, cost_cents, price_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(`product-${crypto.randomUUID()}`, name, clean(body.brand), category, clean(body.sku), clean(body.barcode), costCents, priceCents, clean(body.status) || "Active")
    .run();
  return jsonResponse({ ok: true });
}

async function createStaff(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  if (!name) return jsonResponse({ error: "Staff name is required." }, 400);
  const id = `staff-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO staff (id, branch_id, name, role, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, "", name, clean(body.role) || "Stylist", clean(body.email), clean(body.phone), clean(body.status) || "Active")
    .run();
  return jsonResponse({ ok: true, id }, 201);
}

async function updateStaff(request, env, staffId) {
  if (!staffId) return jsonResponse({ error: "Staff member is required." }, 400);
  const body = await request.json();
  const name = clean(body.name);
  if (!name) return jsonResponse({ error: "Staff name is required." }, 400);
  const existing = await env.DB.prepare("SELECT id FROM staff WHERE id = ?").bind(staffId).first();
  if (!existing) return jsonResponse({ error: "Staff member not found." }, 404);
  await env.DB.prepare("UPDATE staff SET branch_id = ?, name = ?, role = ?, email = ?, phone = ?, status = ? WHERE id = ?")
    .bind("", name, clean(body.role) || "Stylist", clean(body.email), clean(body.phone), clean(body.status) === "Inactive" ? "Inactive" : "Active", staffId)
    .run();
  return jsonResponse({ ok: true });
}

async function saveStaffRoster(request, env) {
  const body = await request.json();
  const staffId = clean(body.staffId);
  const rosterDate = clean(body.rosterDate);
  const status = clean(body.status) === "Day off" ? "Day off" : "Working";
  const branchId = status === "Working" ? clean(body.branchId) : "";
  if (!staffId || !rosterDate || (status === "Working" && !branchId)) {
    return jsonResponse({ error: "Staff, date, and a branch for working days are required." }, 400);
  }
  await env.DB.prepare(`INSERT INTO staff_roster (id, staff_id, branch_id, roster_date, start_time, end_time, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(staff_id, roster_date) DO UPDATE SET branch_id = excluded.branch_id, start_time = excluded.start_time,
      end_time = excluded.end_time, status = excluded.status, notes = excluded.notes`)
    .bind(`roster-${crypto.randomUUID()}`, staffId, branchId || null, rosterDate, status === "Working" ? clean(body.startTime) : "", status === "Working" ? clean(body.endTime) : "", status, clean(body.notes))
    .run();
  return jsonResponse({ ok: true });
}

async function deleteStaffRoster(request, env, url) {
  const staffId = clean(url.searchParams.get("staffId"));
  const rosterDate = clean(url.searchParams.get("rosterDate"));
  if (!staffId || !rosterDate) return jsonResponse({ error: "Staff and roster date are required." }, 400);
  await env.DB.prepare("DELETE FROM staff_roster WHERE staff_id = ? AND roster_date = ?").bind(staffId, rosterDate).run();
  return jsonResponse({ ok: true });
}

async function saveStaffRegularDaysOff(request, env) {
  const body = await request.json();
  const staffId = clean(body.staffId);
  const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
  if (!staffId) return jsonResponse({ error: "Staff member is required." }, 400);
  const statements = [env.DB.prepare("DELETE FROM staff_regular_days_off WHERE staff_id = ?").bind(staffId)];
  days.forEach((day) => statements.push(env.DB.prepare("INSERT INTO staff_regular_days_off (staff_id, day_of_week) VALUES (?, ?)").bind(staffId, day)));
  await env.DB.batch(statements);
  return jsonResponse({ ok: true });
}

async function createBranch(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  const address = clean(body.address);
  const phone = clean(body.phone);
  const postCode = clean(body.postCode);
  if (!name || !address || !phone) return jsonResponse({ error: "Branch name, address, and phone are required." }, 400);
  const id = `branch-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO branches (id, name, address, phone, post_code, pin_code, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, name, address, phone, postCode, postCode, clean(body.status) || "Open")
    .run();
  return jsonResponse({ ok: true, id }, 201);
}

async function deleteBranch(request, env, branchId) {
  if (!branchId) return jsonResponse({ error: "Branch is required." }, 400);
  const branch = (await all(env, "SELECT id FROM branches WHERE id = ?", [branchId]))[0];
  if (!branch) return jsonResponse({ error: "Branch not found." }, 404);
  const dependencies = await Promise.all([
    countBranchRows(env, "customers", branchId),
    countBranchRows(env, "bookings", branchId),
    countBranchRows(env, "sales", branchId),
    countBranchRows(env, "stock_movements", branchId),
    countBranchRows(env, "daily_closings", branchId),
    countBranchRows(env, "staff_roster", branchId)
  ]);
  if (dependencies.some(Boolean)) return jsonResponse({ error: "This branch has business records and cannot be deleted. Set it to closed instead." }, 409);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM inventory_stock WHERE branch_id = ?").bind(branchId),
    env.DB.prepare("DELETE FROM branch_hours WHERE branch_id = ?").bind(branchId),
    env.DB.prepare("DELETE FROM branch_closed_dates WHERE branch_id = ?").bind(branchId),
    env.DB.prepare("UPDATE staff SET branch_id = '' WHERE branch_id = ?").bind(branchId),
    env.DB.prepare("DELETE FROM branches WHERE id = ?").bind(branchId)
  ]);
  return jsonResponse({ ok: true });
}

async function countBranchRows(env, table, branchId) {
  const result = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE branch_id = ?`).bind(branchId).first();
  return Number(result?.count || 0);
}

async function createStockMovement(request, env) {
  const body = await request.json();
  const branchId = clean(body.branchId);
  const productId = clean(body.productId);
  const quantity = Number(body.quantity || 0);
  const movementType = clean(body.movementType) || "Receive";
  if (!branchId || !productId || !quantity) return jsonResponse({ error: "Branch, product, and quantity are required." }, 400);
  const delta = movementType === "Sale" || movementType === "Transfer out" || movementType === "Adjustment out" ? -Math.abs(quantity) : Math.abs(quantity);
  await applyStockMovement(env, branchId, productId, delta, movementType, clean(body.reason), clean(body.reference));
  return jsonResponse({ ok: true });
}

async function createDailyClosing(request, env) {
  const body = await request.json();
  const branchId = clean(body.branchId) || clean(request.headers.get("x-branch-id"));
  const closingDate = clean(body.closingDate);
  if (!branchId || !closingDate) return jsonResponse({ error: "Branch and closing date are required." }, 400);
  const expected = await expectedClosingTotals(env, branchId, closingDate);
  const previousCashCents = body.previousCash === undefined ? await previousRemainingCash(env, branchId, closingDate) : Math.round(Number(body.previousCash || 0) * 100);
  const openingFloatCents = Math.round(Number(body.openingFloat || 0) * 100);
  const actualCashCents = Math.round(Number(body.actualCash || 0) * 100);
  const cashTakenCents = Math.round(Number(body.cashTaken || 0) * 100);
  const remainingCashCents = Math.max(0, actualCashCents - cashTakenCents);
  const actualCardCents = Math.round(Number(body.actualCard || 0) * 100);
  const cashVarianceCents = actualCashCents - (previousCashCents + openingFloatCents + expected.cashCents);
  const cardVarianceCents = actualCardCents - expected.cardCents;
  const status = cashVarianceCents || cardVarianceCents ? "Variance" : "Balanced";
  await env.DB.prepare(
    `INSERT INTO daily_closings (
      id, created_at, branch_id, closing_date, previous_cash_cents, opening_float_cents,
      expected_cash_cents, actual_cash_cents, cash_variance_cents,
      cash_taken_cents, remaining_cash_cents,
      expected_card_cents, actual_card_cents, card_variance_cents,
      notes, status, closed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      `closing-${crypto.randomUUID()}`,
      new Date().toISOString(),
      branchId,
      closingDate,
      previousCashCents,
      openingFloatCents,
      expected.cashCents,
      actualCashCents,
      cashVarianceCents,
      cashTakenCents,
      remainingCashCents,
      expected.cardCents,
      actualCardCents,
      cardVarianceCents,
      clean(body.notes),
      status,
      clean(body.closedBy) || "Admin"
    )
    .run();
  return jsonResponse({ ok: true });
}

async function updateDailyClosing(request, env, closingId) {
  const body = await request.json();
  const existing = (await all(env, "SELECT * FROM daily_closings WHERE id = ?", [closingId]))[0];
  if (!existing) return jsonResponse({ error: "Daily closing record not found." }, 404);
  const expected = await expectedClosingTotals(env, existing.branch_id, existing.closing_date);
  const previousCashCents = body.previousCash === undefined ? Number(existing.previous_cash_cents ?? await previousRemainingCash(env, existing.branch_id, existing.closing_date)) : Math.round(Number(body.previousCash || 0) * 100);
  const openingFloatCents = body.openingFloat === undefined ? Number(existing.opening_float_cents || 0) : Math.round(Number(body.openingFloat || 0) * 100);
  const actualCashCents = body.actualCash === undefined ? Number(existing.actual_cash_cents || 0) : Math.round(Number(body.actualCash || 0) * 100);
  const cashTakenCents = body.cashTaken === undefined ? Number(existing.cash_taken_cents || 0) : Math.round(Number(body.cashTaken || 0) * 100);
  const remainingCashCents = Math.max(0, actualCashCents - cashTakenCents);
  const actualCardCents = body.actualCard === undefined ? Number(existing.actual_card_cents || 0) : Math.round(Number(body.actualCard || 0) * 100);
  const cashVarianceCents = actualCashCents - (previousCashCents + openingFloatCents + expected.cashCents);
  const cardVarianceCents = actualCardCents - expected.cardCents;
  const requestedStatus = clean(body.status);
  const status = requestedStatus || (cashVarianceCents || cardVarianceCents ? "Variance" : "Balanced");
  const approvedBy = clean(body.approvedBy);

  await env.DB.prepare(
    `UPDATE daily_closings SET
      previous_cash_cents = ?,
      opening_float_cents = ?,
      expected_cash_cents = ?,
      actual_cash_cents = ?,
      cash_variance_cents = ?,
      cash_taken_cents = ?,
      remaining_cash_cents = ?,
      expected_card_cents = ?,
      actual_card_cents = ?,
      card_variance_cents = ?,
      notes = ?,
      status = ?,
      approved_by = ?,
      approved_at = ?
     WHERE id = ?`
  )
    .bind(
      previousCashCents,
      openingFloatCents,
      expected.cashCents,
      actualCashCents,
      cashVarianceCents,
      cashTakenCents,
      remainingCashCents,
      expected.cardCents,
      actualCardCents,
      cardVarianceCents,
      clean(body.notes),
      status,
      approvedBy || null,
      status === "Approved" ? new Date().toISOString() : null,
      closingId
    )
    .run();
  return jsonResponse({ ok: true });
}

async function saveBranchHours(request, env) {
  const body = await request.json();
  const branchId = clean(body.branchId);
  const day = Number(body.dayOfWeek);
  if (!branchId || Number.isNaN(day)) return jsonResponse({ error: "Branch and day are required." }, 400);
  await env.DB.prepare(
    `INSERT INTO branch_hours (branch_id, day_of_week, open_time, close_time, is_closed)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(branch_id, day_of_week) DO UPDATE SET
      open_time = excluded.open_time,
      close_time = excluded.close_time,
      is_closed = excluded.is_closed`
  )
    .bind(branchId, day, clean(body.openTime) || "09:00", clean(body.closeTime) || "17:30", body.isClosed ? 1 : 0)
    .run();
  return jsonResponse({ ok: true });
}

async function createClosedDate(request, env) {
  const body = await request.json();
  const branchId = clean(body.branchId);
  const closedDate = clean(body.closedDate);
  if (!branchId || !closedDate) return jsonResponse({ error: "Branch and closed date are required." }, 400);
  await env.DB.prepare("INSERT INTO branch_closed_dates (id, branch_id, closed_date, reason) VALUES (?, ?, ?, ?)")
    .bind(`closed-${crypto.randomUUID()}`, branchId, closedDate, clean(body.reason) || "Closed")
    .run();
  return jsonResponse({ ok: true });
}

async function createDiscount(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  const amount = Number(body.amount || 0);
  if (!name || !amount) return jsonResponse({ error: "Discount name and amount are required." }, 400);
  await env.DB.prepare("INSERT INTO discounts (id, created_at, name, type, amount, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(`discount-${crypto.randomUUID()}`, new Date().toISOString(), name, clean(body.type) || "Percent", amount, clean(body.startsAt), clean(body.endsAt), clean(body.status) || "Active")
    .run();
  return jsonResponse({ ok: true });
}

async function createSale(request, env) {
  const body = await request.json();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const branchId = clean(body.branchId);
  const bookingId = clean(body.bookingId);
  let booking = null;
  let customerId = clean(body.customerId) || await ensureSaleCustomer(env, body, branchId);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!branchId || !items.length) {
    return jsonResponse({ error: "Branch and sale items are required." }, 400);
  }

  if (bookingId) {
    booking = (await all(env, "SELECT * FROM bookings WHERE id = ? AND branch_id = ?", [bookingId, branchId]))[0];
    if (!booking) return jsonResponse({ error: "Booking was not found for this branch." }, 404);
    if (booking.sale_id || booking.payment_status === "Paid") {
      return jsonResponse({ error: "This booking has already been checked out." }, 409);
    }
    if (booking.status === "Cancelled" || booking.status === "No show") {
      return jsonResponse({ error: `A ${booking.status.toLowerCase()} booking cannot be checked out.` }, 409);
    }
    customerId = booking.customer_id;
  }

  const serviceIds = items.filter((item) => clean(item.itemType || "service") === "service").map((item) => clean(item.itemId || item.serviceId)).filter(Boolean);
  const productIds = items.filter((item) => clean(item.itemType) === "product").map((item) => clean(item.itemId)).filter(Boolean);
  if (!serviceIds.length && !productIds.length) {
    return jsonResponse({ error: "Select at least one service or product." }, 400);
  }
  if (booking) {
    const bookedServiceIds = parseIdList(booking.service_ids);
    const missingService = bookedServiceIds.find((serviceId) => !serviceIds.includes(serviceId));
    if (missingService) return jsonResponse({ error: "All booked services must remain in the checkout sale." }, 400);
  }

  const serviceRows = serviceIds.length ? await all(env, `SELECT id, name, price_cents FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`, serviceIds) : [];
  const productRows = productIds.length ? await all(env, `SELECT id, name, price_cents FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`, productIds) : [];
  const serviceMap = new Map(serviceRows.map((service) => [service.id, service]));
  const productMap = new Map(productRows.map((product) => [product.id, product]));
  const saleItems = items
    .map((item) => {
      const itemType = clean(item.itemType || "service");
      const isProduct = itemType === "product";
      const record = isProduct ? productMap.get(clean(item.itemId)) : serviceMap.get(clean(item.itemId || item.serviceId));
      if (!record) return null;
      const instancePriceCents = Math.round(Number(item.instancePrice || 0) * 100);
      return {
        itemType: isProduct ? "product" : "service",
        serviceId: isProduct ? null : record.id,
        productId: isProduct ? record.id : null,
        name: isProduct ? record.name : (clean(item.instanceName) || record.name),
        priceCents: !isProduct && instancePriceCents > 0 ? instancePriceCents : Number(record.price_cents || 0),
        staffIds: isProduct ? [] : (Array.isArray(item.staffIds) ? item.staffIds.map(clean).filter(Boolean) : []),
        staffAllocations: isProduct ? [] : normalizeStaffAllocations(item.staffAllocations)
      };
    })
    .filter(Boolean);
  if (!saleItems.length) {
    return jsonResponse({ error: "Select valid services or products for the sale." }, 400);
  }
  for (const item of saleItems) {
    if (item.itemType !== "service") continue;
    const percentages = item.staffAllocations.map((allocation) => allocation.percent);
    const amounts = item.staffAllocations.map((allocation) => allocation.amountCents);
    if ([...percentages, ...amounts].some((value) => !Number.isFinite(value) || value < 0)) {
      return jsonResponse({ error: `Staff allocations for ${item.name} must be valid positive numbers.` }, 400);
    }
    const percentTotal = percentages.reduce((sum, value) => sum + value, 0);
    const amountTotal = amounts.reduce((sum, value) => sum + value, 0);
    const combinedCredit = amountTotal + Math.round(item.priceCents * percentTotal / 100);
    if (percentTotal > 100) return jsonResponse({ error: `Staff percentages for ${item.name} cannot exceed 100%.` }, 400);
    if (amountTotal > item.priceCents) return jsonResponse({ error: `Staff dollar allocations for ${item.name} cannot exceed ${formatDollars(item.priceCents)}.` }, 400);
    if (combinedCredit > item.priceCents) return jsonResponse({ error: `Combined staff allocations for ${item.name} cannot exceed the service amount.` }, 400);
  }
  const totalCents = saleItems.reduce((total, item) => total + item.priceCents, 0);
  const cashCents = Math.round(Number(body.cashAmount || 0) * 100);
  const cardCents = Math.round(Number(body.cardAmount || 0) * 100);
  if (cashCents + cardCents < totalCents) {
    return jsonResponse({ error: "Payment total must cover the sale amount." }, 400);
  }
  const paymentMethod = paymentLabel(cashCents, cardCents, totalCents, clean(body.paymentMethod));
  const changeCents = Math.max(0, cashCents + cardCents - totalCents);

  const saleStatements = [env.DB.prepare(
    `INSERT INTO sales (id, created_at, branch_id, customer_id, staff_id, total_cents, payment_method, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      now,
      branchId,
      customerId || null,
      null,
      totalCents,
      paymentMethod,
      "Paid"
    ),
    ...saleItems.map((item) =>
      env.DB.prepare(
        "INSERT INTO sale_items (id, sale_id, item_name, quantity, price_cents, service_id, staff_ids, staff_allocations) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), id, item.name, 1, item.priceCents, item.serviceId, JSON.stringify(item.staffIds), JSON.stringify(item.staffAllocations))
    )
  ];
  if (booking) {
    saleStatements.push(env.DB.prepare(
      "UPDATE bookings SET updated_at = ?, status = 'Completed', payment_status = 'Paid', sale_id = ? WHERE id = ? AND sale_id IS NULL"
    ).bind(now, id, booking.id));
  }
  await env.DB.batch(saleStatements);

  const productItems = saleItems.filter((item) => item.productId);
  if (productItems.length) {
    await env.DB.batch(productItems.map((item) =>
      env.DB.prepare(
        `INSERT INTO inventory_stock (branch_id, product_id, quantity, low_stock_level)
         VALUES (?, ?, ?, 3)
         ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = quantity - 1`
      ).bind(branchId, item.productId, -1)
    ));
    await env.DB.batch(productItems.map((item) =>
      env.DB.prepare("INSERT INTO stock_movements (id, created_at, branch_id, product_id, movement_type, quantity_delta, reason, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), now, branchId, item.productId, "Sale", -1, "POS sale", id)
    ));
  }

  const branch = (await all(env, "SELECT name, address, phone FROM branches WHERE id = ?", [branchId]))[0];
  return jsonResponse({ ok: true, saleId: id, bookingId: booking?.id || null, totalCents, receipt: { saleId: id, bookingId: booking?.id || null, createdAt: now, branch, items: saleItems, totalCents, cashCents, cardCents, changeCents, paymentMethod } });
}

function parseIdList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(clean).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeStaffAllocations(allocations) {
  if (!Array.isArray(allocations)) return [];
  return allocations.map((allocation) => ({
    staffId: clean(allocation.staffId),
    percent: Number(allocation.percent || 0),
    amountCents: Math.round(Number(allocation.amount || 0) * 100)
  })).filter((allocation) => allocation.staffId);
}

async function ensureSaleCustomer(env, body, branchId) {
  if (clean(body.customerMode) !== "new") return "";
  const category = clean(body.customerCategory) || "Non-member";
  return ensureBookingCustomer(env, body.newCustomer || {}, branchId, category);
}

function paymentLabel(cashCents, cardCents, totalCents, fallback) {
  const changeCents = Math.max(0, cashCents + cardCents - totalCents);
  const changeText = changeCents ? ` / change ${formatDollars(changeCents)}` : "";
  if (cashCents > 0 && cardCents > 0) return `Split cash ${formatDollars(cashCents)} / card ${formatDollars(cardCents)}${changeText}`;
  if (cashCents > 0) return `Cash ${formatDollars(cashCents)}${changeText}`;
  if (cardCents > 0) return `Card ${formatDollars(cardCents)}`;
  return fallback || "Pay at counter";
}

function formatDollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

async function applyStockMovement(env, branchId, productId, delta, movementType, reason, reference) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO inventory_stock (branch_id, product_id, quantity, low_stock_level)
     VALUES (?, ?, ?, 3)
     ON CONFLICT(branch_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity`
  )
    .bind(branchId, productId, delta)
    .run();
  await env.DB.prepare("INSERT INTO stock_movements (id, created_at, branch_id, product_id, movement_type, quantity_delta, reason, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), now, branchId, productId, movementType, delta, reason, reference)
    .run();
}

async function expectedClosingTotals(env, branchId, closingDate) {
  const rows = await all(env, "SELECT total_cents, payment_method FROM sales WHERE branch_id = ? AND substr(created_at, 1, 10) = ? AND status = 'Paid'", [branchId, closingDate]);
  return rows.reduce((totals, sale) => {
    const method = String(sale.payment_method || "");
    const cash = method.match(/Cash \$([0-9.]+)/i) || method.match(/cash \$([0-9.]+)/i);
    const card = method.match(/Card \$([0-9.]+)/i) || method.match(/card \$([0-9.]+)/i);
    const change = method.match(/change \$([0-9.]+)/i);
    if (cash) totals.cashCents += Math.max(0, Math.round(Number(cash[1]) * 100) - (change ? Math.round(Number(change[1]) * 100) : 0));
    if (card) totals.cardCents += Math.round(Number(card[1]) * 100);
    if (!cash && !card && method.toLowerCase().includes("cash")) totals.cashCents += Number(sale.total_cents || 0);
    if (!cash && !card && method.toLowerCase().includes("card")) totals.cardCents += Number(sale.total_cents || 0);
    return totals;
  }, { cashCents: 0, cardCents: 0 });
}

async function previousRemainingCash(env, branchId, closingDate) {
  const rows = await all(env, `SELECT remaining_cash_cents, actual_cash_cents
    FROM daily_closings
    WHERE branch_id = ? AND closing_date < ?
    ORDER BY closing_date DESC
    LIMIT 1`, [branchId, closingDate]);
  const previous = rows[0];
  return Number(previous?.remaining_cash_cents ?? previous?.actual_cash_cents ?? 0);
}

async function all(env, sql, params = []) {
  const statement = env.DB.prepare(sql);
  const result = params.length ? await statement.bind(...params).all() : await statement.all();
  return result.results || [];
}

async function authorizeBranch(request, env) {
  const branchId = clean(request.headers.get("x-branch-id"));
  const branchPin = clean(request.headers.get("x-branch-pin"));
  if (!branchId || !branchPin) {
    return jsonResponse({ error: "Select a branch and enter the postcode PIN." }, 401);
  }

  const rows = await all(env, "SELECT post_code FROM branches WHERE id = ? AND status = 'Open'", [branchId]);
  if (rows[0]?.post_code && rows[0].post_code === branchPin) {
    return null;
  }

  return jsonResponse({ error: "Incorrect branch PIN." }, 401);
}

async function authorizeSale(request, env) {
  const cloned = request.clone();
  const body = await cloned.json();
  const branchId = clean(body.branchId);
  const branchPin = clean(request.headers.get("x-branch-pin"));
  if (!branchId || !branchPin) {
    return jsonResponse({ error: "Branch PIN is required for POS sales." }, 401);
  }

  const rows = await all(env, "SELECT post_code FROM branches WHERE id = ? AND status = 'Open'", [branchId]);
  if (rows[0]?.post_code && rows[0].post_code === branchPin) {
    return null;
  }

  return jsonResponse({ error: "Incorrect branch PIN." }, 401);
}

async function authorizeBookingEdit(request, env) {
  const branchId = clean(request.headers.get("x-branch-id"));
  const branchPin = clean(request.headers.get("x-branch-pin"));
  if (!branchId || !branchPin) {
    return jsonResponse({ error: "Branch PIN is required to edit bookings." }, 401);
  }

  const rows = await all(env, "SELECT post_code FROM branches WHERE id = ? AND status = 'Open'", [branchId]);
  if (rows[0]?.post_code && rows[0].post_code === branchPin) {
    return null;
  }

  return jsonResponse({ error: "Incorrect branch PIN." }, 401);
}

function clean(value) {
  return String(value ?? "").trim().slice(0, 500);
}

async function logEvent(event) {
  console.log(JSON.stringify({ event, at: new Date().toISOString() }));
}

function htmlResponse(markup) {
  return new Response(markup, { headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" } });
}

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { "x-content-type-options": "nosniff" } });
}

const UI_ICON_PATHS = {
  dashboard:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
  customers:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  staff:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  roster:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  services:'<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15ZM5 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/>',
  products:'<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5v9l-9-5V8ZM21 8l-9 5v9l9-5V8Z"/>',
  inventory:'<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/>',
  reports:'<path d="M3 3v18h18"/><path d="m7 16 4-5 3 3 5-7"/>',
  branches:'<path d="M3 21h18M5 21V9l7-4 7 4v12M9 21v-5h6v5M9 11h.01M15 11h.01"/>',
  access:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  pos:'<path d="M4 5h16l-1 6H5L4 5Z"/><path d="M7 11v8h10v-8M9 15h6"/>',
  bookings:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  closing:'<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  sales:'<path d="M3 3v18h18"/><path d="m7 16 4-5 3 3 5-7"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  money:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.4c0 3.6 6 1.6 6 5.1 0 1.4-1.3 2.5-3 2.5s-3-1.1-3-2.5"/>',
  trend:'<path d="m4 16 5-5 4 4 7-8"/><path d="M15 7h5v5"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h2"/>',
  bank:'<path d="m3 10 9-6 9 6M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M3 20h18"/>',
  voucher:'<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V7Z"/><path d="M12 7v12"/>'
};
function appIcon(name) { return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (UI_ICON_PATHS[name] || UI_ICON_PATHS.dashboard) + '</svg>'; }

function renderApp(initialBranchId, initialTab, mode = "admin") {
  const isAdmin = mode === "admin";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Kunchas Cloud Software</title>
  <style>${styles()}</style>
</head>
<body class="${isAdmin ? "admin-mode" : "staff-mode"}">
  <aside class="sidebar">
    <div class="brand"><span>K</span><strong>Kunchas</strong></div>
    <nav>
      ${isAdmin ? `
      <button class="nav ${initialTab === "overview" ? "active" : ""}" data-tab="overview">${appIcon("dashboard")}<span>Dashboard</span></button>
      <button class="nav" data-tab="customers">${appIcon("customers")}<span>Customers</span></button>
      <button class="nav" data-tab="staff">${appIcon("staff")}<span>Staff</span></button>
      <button class="nav" data-tab="roster">${appIcon("roster")}<span>Roster</span></button>
      <button class="nav" data-tab="services">${appIcon("services")}<span>Services</span></button>
      <button class="nav" data-tab="products">${appIcon("products")}<span>Products</span></button>
      <button class="nav" data-tab="inventory">${appIcon("inventory")}<span>Inventory</span></button>
      <button class="nav" data-tab="reports">${appIcon("reports")}<span>Reports</span></button>
      <button class="nav" data-tab="branches">${appIcon("branches")}<span>Branches</span></button>
      <button class="nav" data-tab="access">${appIcon("access")}<span>Access</span></button>` : `
      <button class="nav ${initialTab === "pos" ? "active" : ""}" data-tab="pos">${appIcon("pos")}<span>POS</span></button>
      <button class="nav ${initialTab === "bookings" ? "active" : ""}" data-tab="bookings">${appIcon("bookings")}<span>Bookings</span></button>
      <button class="nav" data-tab="closing">${appIcon("closing")}<span>Daily Closing</span></button>`}
      ${isAdmin ? "" : `<button class="nav" data-tab="recent-sales">${appIcon("sales")}<span>Recent Sales</span></button>`}
    </nav>
  </aside>

  <main class="app">
    <header class="topbar">
      <div>
        <p class="eyebrow">Cloud software for SMBs</p>
        <h1 id="appTitle">${isAdmin ? "Dashboard" : "Kunchas staff workspace"}</h1>
      </div>
      ${isAdmin ? `<div class="admin-controls"><label class="branch-switcher"><span>Viewing</span><select id="globalBranchFilter" aria-label="Choose branch"><option value="">All branches</option></select></label><div class="admin-avatar"><span>AD</span><strong>Admin</strong></div></div>` : ""}
    </header>

    <div class="load-row admin-only">
      <button class="primary" id="loadData" type="button">Refresh data</button>
    </div>
    <p class="message" id="message">${isAdmin ? "Loading admin data." : "Open your branch with the postcode PIN."}</p>

    <section class="tab admin-only ${initialTab === "overview" ? "active" : ""}" id="overview">
      <div class="dashboard-toolbar">
        <div class="period-tabs" role="group" aria-label="Dashboard period">
          <button class="period-tab active" type="button" data-period="today">Today</button>
          <button class="period-tab" type="button" data-period="week">This week</button>
          <button class="period-tab" type="button" data-period="month">This month</button>
          <button class="period-tab" type="button" data-period="last-month">Last month</button>
        </div>
      </div>
      <div class="metrics" id="metrics"></div>
      <div class="panel bookings-chart-panel">
        <div class="section-heading"><div><h2>Bookings by hour</h2><p class="hint" id="dashboardPeriodLabel"></p></div><div class="chart-legend"><span></span>Bookings</div></div>
        <div class="bookings-chart" id="bookingsChart"></div>
      </div>
      <div class="dashboard-lower-grid">
        <div class="panel dashboard-list-panel"><div class="section-heading"><h2>Coming up next</h2><span class="text-link">View all</span></div><div class="dashboard-upcoming" id="dashboardUpcoming"></div></div>
        <div class="panel dashboard-list-panel"><div class="section-heading"><div><h2>Staff on shift</h2><p class="hint" id="dashboardRosterDate"></p></div><span class="text-link">View all</span></div><div class="dashboard-roster" id="dashboardRoster"></div></div>
        <div class="panel dashboard-list-panel"><div class="section-heading"><h2>Activity feed</h2><span class="text-link">View all</span></div><div class="dashboard-activity" id="dashboardActivity"></div></div>
      </div>
    </section>

    <div class="panel pos-login staff-only" id="posLogin">
      <h2>Open branch workspace</h2>
      <p class="hint">Select a branch and enter that branch postcode as the PIN. These are default PINs for now.</p>
      <div class="grid">
        <label>Branch<select id="posBranch" required></select></label>
        <label>Postcode PIN<input id="posPin" inputmode="numeric" autocomplete="off" placeholder="Branch postcode"></label>
      </div>
      <button class="primary" id="openPos" type="button">Open branch</button>
    </div>

    <section class="tab staff-only ${initialTab === "pos" ? "active" : ""}" id="pos">
      <div class="pos-workspace hidden" id="posWorkspace">
      <div class="pos-branch-bar">
        <div>
          <p class="eyebrow">Current branch</p>
          <h2 id="posBranchName">Branch POS</h2>
        </div>
        <button class="secondary" id="switchBranch" type="button">Switch branch</button>
      </div>
      <div class="split">
        <form class="panel" id="saleForm">
          <h2>New POS sale</h2>
          <input name="branchId" type="hidden">
          <input name="bookingId" type="hidden">
          <label>Checkout a booking<select id="bookingCheckout"><option value="">New walk-in sale</option></select></label>
          <p class="hint booking-checkout-hint">Choose an unpaid booking to preload its customer, services, and assigned staff.</p>
          <label>Customer type<select name="customerMode"><option value="walkin">Walking customer</option><option value="existing">Existing customer</option><option value="new">Add new customer</option></select></label>
          <div class="customer-existing hidden">
            <label>Customer search<input name="customerSearch" list="customerList" placeholder="Type name, phone, or email"></label>
          </div>
          <div class="customer-new hidden">
            <label>Category<select name="customerCategory"><option>Member</option><option>Non-member</option></select></label>
            <div class="grid"><label>First name<input name="newFirstName"></label><label>Last name<input name="newLastName"></label></div>
            <div class="grid"><label>Phone<input name="newPhone"></label><label>Email<input name="newEmail" type="email"></label></div>
          </div>
          <input name="customerId" type="hidden">
          <datalist id="customerList"></datalist>
          <datalist id="itemList"></datalist>
          <datalist id="staffList"></datalist>
          <div id="saleItems"></div>
          <button class="secondary" id="addSaleItem" type="button">Add item</button>
          <div class="grid">
            <label>Cash amount $<input name="cashAmount" type="number" min="0" step="0.01" placeholder="0.00"></label>
            <label>Card amount $<input name="cardAmount" type="number" min="0" step="0.01" placeholder="0.00"></label>
          </div>
          <p class="hint">Use one box for full cash/card, or both boxes for split payment.</p>
          <button class="primary full" type="submit">Complete sale</button>
          <button class="secondary full hidden" id="printReceipt" type="button">Print receipt / open cash drawer</button>
          <p class="hint">Cash drawer opens only when it is connected to the receipt printer and configured to open on receipt print.</p>
        </form>
        <div class="panel cart-panel"><h2>Sale summary</h2><div id="cartSummary" class="cart-summary"></div><div class="cart-total"><span>Total</span><strong id="cartTotal">$0.00</strong></div></div>
      </div>
      </div>
    </section>

    <section class="tab staff-only" id="recent-sales">
      <div class="panel"><h2>Recent sales</h2><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Total</th><th>Method</th><th>Status</th></tr></thead><tbody id="salesTable"></tbody></table></div></div>
    </section>

    <section class="tab staff-only ${initialTab === "bookings" ? "active" : ""}" id="bookings">
      <div class="split">
        <form class="panel" id="bookingForm">
          <h2>New booking</h2>
          <input name="branchId" type="hidden">
          <div class="grid"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label></div>
          <div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div>
          <label>Staff<select name="staffId"></select></label>
          <div class="grid"><label>Date<input name="bookingDate" type="date" required></label><label>Time<input name="bookingTime" type="time" required></label></div>
          <div class="booking-service-picker"><span class="field-label">Services</span><div class="staff-add-row"><input id="bookingServiceSearch" list="bookingServiceList" placeholder="Type service name, category, or price"><button class="secondary" id="addBookingService" type="button">Add</button></div><datalist id="bookingServiceList"></datalist><div class="selected-booking-services" id="bookingSelectedServices"></div><div class="booking-service-total"><span>Total</span><strong id="bookingServiceTotal">$0.00</strong></div></div>
          <label>Notes<textarea name="notes" rows="3"></textarea></label>
          <button class="primary full" type="submit">Save booking</button>
        </form>
        <div class="panel"><h2>Online and manual bookings</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Staff</th><th>Services</th><th>Status</th><th></th></tr></thead><tbody id="bookingsTable"></tbody></table></div></div>
      </div>
    </section>

    <section class="tab admin-only" id="customers">
      <div class="split">
        <form class="panel" id="customerForm">
          <h2>Add customer</h2>
          <div class="grid"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label></div>
          <div class="grid"><label>Email<input name="email" type="email" required></label><label>Phone<input name="phone" required></label></div>
          <label>Home branch<select name="branchId" required></select></label>
          <label>Tags<input name="tags" placeholder="VIP, colour client"></label>
          <label>Notes<textarea name="notes" rows="3"></textarea></label>
          <button class="primary full" type="submit">Save customer</button>
        </form>
        <div class="panel"><h2>Customers</h2><p class="hint">Click a customer to see and edit their details and visit history.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tags</th></tr></thead><tbody id="customersTable"></tbody></table></div></div>
      </div>
      <div class="panel customer-profile hidden" id="customerProfile">
        <div class="profile-heading"><div><h2 id="customerProfileTitle">Customer details</h2><p class="hint" id="customerProfileSummary"></p></div><button class="secondary" id="closeCustomerProfile" type="button">Close</button></div>
        <form id="customerProfileForm"><input name="customerId" type="hidden"><div class="grid"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label></div><div class="grid"><label>Email<input name="email" type="email" required></label><label>Phone<input name="phone" required></label></div><label>Home branch<select name="branchId" required></select></label><label>Tags<input name="tags"></label><label>Notes<textarea name="notes" rows="4" placeholder="Customer preferences, colour formulas, allergies, or other notes"></textarea></label><button class="primary" type="submit">Save customer details</button></form>
        <h3>Service and sales history</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Location</th><th>Service / item</th><th>Staff</th><th>Amount</th><th>Payment</th></tr></thead><tbody id="customerHistoryTable"></tbody></table></div>
      </div>
    </section>

    <section class="tab admin-only" id="staff">
      <div class="split">
        <form class="panel" id="staffForm"><h2>Add staff</h2><input name="staffId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Role<input name="role" placeholder="Senior stylist"></label></div><div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label><fieldset class="day-off-fieldset"><legend>Regular day off</legend><p class="hint">Choose their usual weekly day or days off.</p><div class="day-checks" data-day-off-checks></div></fieldset><button class="primary full" type="submit">Save staff</button></form>
        <div class="panel"><h2>Staff</h2><p class="hint">Staff are shared across all branches and assigned through the roster.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Day off</th><th>Status</th><th>Sales made</th></tr></thead><tbody id="staffTable"></tbody></table></div></div>
      </div>
      <div class="panel staff-profile hidden" id="staffProfile"><div class="profile-heading"><div><h2 id="staffProfileTitle">Staff details</h2><p class="hint" id="staffProfileSummary"></p></div><button class="secondary" id="closeStaffProfile" type="button">Close</button></div><form id="staffProfileForm"><input name="staffId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Role<input name="role"></label></div><div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label><fieldset class="day-off-fieldset"><legend>Regular day off</legend><div class="day-checks" data-day-off-checks></div></fieldset><button class="primary" type="submit">Save staff details</button></form><h3>Credited sales history</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Service</th><th>Sale value</th><th>Staff credit</th></tr></thead><tbody id="staffSalesTable"></tbody></table></div></div>
    </section>
    <section class="tab admin-only" id="roster">
      <div class="panel roster-day-panel"><div class="roster-toolbar"><div><p class="eyebrow">Schedule builder</p><h2 id="rosterDayTitle">Branch roster</h2><p class="hint">Choose one branch, then add or adjust staff shifts for the selected day.</p></div><div class="roster-toolbar-controls"><label>Branch<select id="rosterBranchSelect" aria-label="Roster branch"></select></label><label>Date<input id="rosterDay" type="date"></label></div></div><div class="roster-branch-board" id="rosterBranchBoard"></div></div>
      <div class="panel roster-calendar-panel"><div class="roster-toolbar"><div><h2>Roster calendar</h2><p class="hint">See coverage and bookings at a glance, then choose a day to edit above.</p></div><label>Month<input id="rosterMonth" type="month"></label></div><div class="month-calendar" id="rosterMonthCalendar"></div></div>
    </section>
    <section class="tab admin-only" id="services">
      <div class="split">
        <form class="panel service-editor" id="serviceForm"><h2 id="serviceFormTitle">Add service</h2><input name="serviceId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Category<input name="category" list="serviceCategories" placeholder="Choose or enter a category" required></label></div><datalist id="serviceCategories"></datalist><div class="grid"><label>Duration minutes<input name="durationMinutes" type="number" min="1" step="1" required></label><label>Price $<input name="price" type="number" min="0.01" step="0.01" required></label></div><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label><div class="form-actions"><button class="primary" id="serviceSaveButton" type="submit">Save service</button><button class="secondary hidden" id="cancelServiceEdit" type="button">Cancel edit</button></div><p class="hint">Drag a service card onto another category to move it.</p></form>
        <div class="panel"><h2>Shared services by category</h2><div id="serviceCategoriesList"></div></div>
      </div>
    </section>
    <section class="tab admin-only" id="products">
      <div class="split">
        <form class="panel" id="productForm"><h2>Add product</h2><div class="grid"><label>Name<input name="name" required></label><label>Brand<input name="brand"></label></div><div class="grid"><label>Category<input name="category" placeholder="Haircare"></label><label>SKU<input name="sku"></label></div><label>Barcode<input name="barcode"></label><div class="grid"><label>Cost $<input name="cost" type="number" min="0" step="0.01"></label><label>Retail $<input name="price" type="number" min="0" step="0.01" required></label></div><button class="primary full" type="submit">Save product</button></form>
        <div class="panel"><h2>Products</h2><div class="cards" id="productCards"></div></div>
      </div>
    </section>
    <section class="tab admin-only" id="inventory">
      <div class="split">
        <form class="panel" id="stockForm"><h2>Stock movement</h2><label>Branch<select name="branchId" required></select></label><label>Product<select name="productId" required></select></label><div class="grid"><label>Type<select name="movementType"><option>Receive</option><option>Adjustment in</option><option>Adjustment out</option><option>Transfer in</option><option>Transfer out</option></select></label><label>Quantity<input name="quantity" type="number" min="1" required></label></div><div class="grid"><label>Reference<input name="reference" placeholder="Invoice / transfer"></label><label>Reason<input name="reason" placeholder="Supplier delivery"></label></div><button class="primary full" type="submit">Save movement</button></form>
        <div class="panel"><h2>All product inventory by branch</h2><div class="table-wrap"><table><thead id="inventoryHead"></thead><tbody id="inventoryTable"></tbody></table></div></div>
      </div>
    </section>
    <section class="tab staff-only" id="closing">
      <div class="split">
        <form class="panel" id="closingForm"><h2>Daily closing</h2><input name="branchId" type="hidden"><label>Date<input name="closingDate" type="date" required></label><div class="closing-summary" id="closingExpected"></div><div class="grid"><label>Yesterday cash $<input name="previousCash" type="number" min="0" step="0.01" readonly></label><label>Extra opening cash $<input name="openingFloat" type="number" min="0" step="0.01" placeholder="0.00"></label></div><div class="grid"><label>Actual cash counted $<input name="actualCash" type="number" min="0" step="0.01"></label><label>Cash taken $<input name="cashTaken" type="number" min="0" step="0.01" placeholder="0.00"></label></div><div class="grid"><label>Remaining cash $<input name="remainingCash" type="number" min="0" step="0.01" readonly></label><label>Actual card terminal total $<input name="actualCard" type="number" min="0" step="0.01"></label></div><div class="closing-summary" id="closingVariance"></div><label>Closed by<input name="closedBy" placeholder="Staff / manager name"></label><label>Notes<textarea name="notes"></textarea></label><button class="primary full" type="submit">Save daily closing</button></form>
        <div class="panel"><h2>Closing records</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Cash taken</th><th>Remaining cash</th><th>Status</th></tr></thead><tbody id="closingTable"></tbody></table></div></div>
      </div>
    </section>
    <section class="tab admin-only" id="reports">
      <div class="panel"><h2>Reports</h2><div class="metrics" id="reportMetrics"></div><div class="branch-grid" id="reportCards"></div></div>
      <div class="panel"><h2>Inventory report by branch</h2><div class="table-wrap"><table><thead id="reportInventoryHead"></thead><tbody id="reportInventoryTable"></tbody></table></div></div>
      <div class="panel"><h2>Admin closing review</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Actual cash</th><th>Cash taken</th><th>Actual card</th><th>Status</th><th>Approved by</th><th></th></tr></thead><tbody id="adminClosingTable"></tbody></table></div></div>
    </section>
    <section class="tab admin-only" id="branches">
      <div class="split">
        <form class="panel" id="branchForm"><h2>Create branch</h2><label>Name<input name="name" required></label><label>Address<input name="address" required></label><div class="grid"><label>Phone<input name="phone" required></label><label>Postcode / PIN<input name="postCode" inputmode="numeric"></label></div><button class="primary full" type="submit">Create branch</button></form>
        <div class="panel"><h2>Branch details</h2><label>Choose branch<select id="branchDetailSelect"></select></label><div id="branchDetail"></div></div>
      </div>
      <div class="split">
        <form class="panel" id="hoursForm"><h2>Branch timetable</h2><label>Branch<select name="branchId" required></select></label><label>Day<select name="dayOfWeek"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option></select></label><div class="grid"><label>Open<input name="openTime" type="time" value="09:00"></label><label>Close<input name="closeTime" type="time" value="17:30"></label></div><label class="check"><input name="isClosed" type="checkbox">Closed every week on this day</label><button class="primary full" type="submit">Save timetable</button></form>
        <form class="panel" id="closedDateForm"><h2>Closed date</h2><label>Branch<select name="branchId" required></select></label><label>Date<input name="closedDate" type="date" required></label><label>Reason<input name="reason" placeholder="Public holiday"></label><button class="primary full" type="submit">Add closed date</button></form>
      </div>
      <div class="panel"><h2>All branches</h2><div class="cards" id="branchCards"></div></div>
    </section>
    <section class="tab admin-only" id="access">
      <div class="section-heading page-heading"><div><p class="eyebrow">Security &amp; entry</p><h2>Branch access</h2><p class="hint">Access is managed separately from branch operations.</p></div></div>
      <div class="panel"><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Branch workspace</th><th>Current PIN</th><th>Status</th></tr></thead><tbody id="accessTable"></tbody></table></div></div>
    </section>
  </main>
  <script>window.initialBranchId = ${JSON.stringify(initialBranchId)}; window.appMode = ${JSON.stringify(mode)}; window.uiIconPaths = ${JSON.stringify(UI_ICON_PATHS)}; ${clientScript()}</script>
</body>
</html>`;
}

function clientScript() {
  return `
let state = { branches: [], staff: [], services: [], products: [], customers: [], bookings: [], sales: [], saleItems: [], branchHours: [], closedDates: [], discounts: [], inventoryStock: [], stockMovements: [], dailyClosings: [], staffRoster: [], staffRegularDaysOff: [] };
let lastReceipt = null;
let selectedPosBranchId = "";
let selectedPosPin = "";
let draggedServiceId = "";
let draggedStaffId = "";
let selectedDashboardPeriod = "today";
let selectedGlobalBranchId = "";
let selectedRosterBranchId = "";
const appMode = window.appMode || "admin";
const message = document.querySelector("#message");
document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => {
  showTab(button.dataset.tab);
}));
document.querySelector("#loadData").addEventListener("click", loadData);
document.querySelector("#openPos").addEventListener("click", openPos);
document.querySelector("#switchBranch").addEventListener("click", switchBranch);
document.querySelector("#addSaleItem").addEventListener("click", () => addSaleItem());
document.querySelector("#bookingCheckout").addEventListener("change", selectBookingForCheckout);
document.querySelector("#printReceipt").addEventListener("click", printLastReceipt);
document.querySelector("#customerForm").addEventListener("submit", submitCustomer);
document.querySelector("#customerProfileForm").addEventListener("submit", submitCustomerProfile);
document.querySelector("#closeCustomerProfile").addEventListener("click", closeCustomerProfile);
document.querySelector("#bookingForm").addEventListener("submit", submitBooking);
document.querySelector("#addBookingService").addEventListener("click", addBookingService);
document.querySelector("#bookingServiceSearch").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addBookingService(); } });
document.querySelector("#saleForm").addEventListener("submit", submitSale);
document.querySelector('select[name="customerMode"]').addEventListener("change", updateCustomerMode);
document.querySelector('#closingForm input[name="closingDate"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="openingFloat"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="actualCash"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="cashTaken"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="actualCard"]').addEventListener("input", renderClosingPreview);
document.querySelector("#staffForm").addEventListener("submit", submitStaffForm);
document.querySelector("#staffProfileForm").addEventListener("submit", submitStaffProfile);
document.querySelector("#closeStaffProfile").addEventListener("click", closeStaffProfile);
document.querySelector("#rosterMonth").addEventListener("change", renderRosterMonthCalendar);
document.querySelector("#rosterDay").addEventListener("change", () => { renderRosterMonthCalendar(); renderRosterBranchBoard(); });
document.querySelector("#rosterBranchSelect").addEventListener("change", (event) => { selectedRosterBranchId = event.currentTarget.value; renderRosterMonthCalendar(); renderRosterBranchBoard(); });
document.querySelector("#globalBranchFilter")?.addEventListener("change", (event) => { selectedGlobalBranchId = event.currentTarget.value; renderMetrics(); });
document.querySelectorAll(".period-tab").forEach((button) => button.addEventListener("click", () => { selectedDashboardPeriod = button.dataset.period; document.querySelectorAll(".period-tab").forEach((item) => item.classList.toggle("active", item === button)); renderMetrics(); }));
document.querySelector("#branchForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/branches"));
document.querySelector("#branchDetailSelect").addEventListener("change", renderBranchDetail);
document.querySelector("#serviceForm").addEventListener("submit", submitServiceForm);
document.querySelector("#cancelServiceEdit").addEventListener("click", resetServiceForm);
document.querySelector("#productForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/products"));
document.querySelector("#stockForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/stock-movements"));
document.querySelector("#closingForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/daily-closing"));
document.querySelector("#hoursForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/branch-hours"));
document.querySelector("#closedDateForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/closed-dates"));
addSaleItem();
updateCustomerMode();
loadPublicBranches();
setInitialRosterWeek();
if (appMode === "admin") loadData();

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (selectedPosBranchId && (path === "/api/pos-data" || path === "/api/sales" || path === "/api/branch-bookings" || path === "/api/daily-closing" || path.startsWith("/api/bookings/"))) {
    headers["x-branch-id"] = selectedPosBranchId;
    headers["x-branch-pin"] = selectedPosPin;
  }
  if (options.body) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
async function loadData() {
  try {
    message.textContent = "Loading Kunchas data...";
    state = normalizeState(await api("/api/app-data"));
    renderAll();
    message.textContent = "";
  } catch (error) {
    message.textContent = error.message;
  }
}
async function loadPublicBranches() {
  try {
    const response = await fetch("/api/branches-public");
    const result = await response.json();
    const options = '<option value="">Select branch</option>' + result.branches.map((branch) => '<option value="' + branch.id + '">' + esc(branch.name) + '</option>').join("");
    document.querySelector("#posBranch").innerHTML = options;
    if (window.initialBranchId) document.querySelector("#posBranch").value = window.initialBranchId;
  } catch (error) {
    message.textContent = "Could not load branches.";
  }
}
async function openPos() {
  selectedPosBranchId = document.querySelector("#posBranch").value;
  selectedPosPin = document.querySelector("#posPin").value;
  if (!selectedPosBranchId || !selectedPosPin) {
    message.textContent = "Select a branch and enter the postcode PIN.";
    return;
  }
  await refreshPosData();
  const branch = state.branches[0];
  document.querySelector("#posBranchName").textContent = branch ? branch.name : "Branch POS";
  document.querySelector('#saleForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#bookingForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#closingForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#closingForm input[name="closingDate"]').value ||= new Date().toISOString().slice(0, 10);
  renderClosingPreview();
  document.querySelector("#posLogin").classList.add("hidden");
  document.querySelector("#posWorkspace").classList.remove("hidden");
}
function switchBranch() {
  selectedPosBranchId = "";
  selectedPosPin = "";
  state = normalizeState();
  document.querySelector("#posWorkspace").classList.add("hidden");
  document.querySelector("#posLogin").classList.remove("hidden");
  document.querySelector("#posPin").value = "";
}
async function refreshPosData() {
  try {
    message.textContent = "Opening branch workspace...";
    state = normalizeState(await api("/api/pos-data"));
    renderAll();
    document.querySelector('#saleForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#bookingForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#closingForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#closingForm input[name="closingDate"]').value ||= new Date().toISOString().slice(0, 10);
    renderClosingPreview();
    message.textContent = "Workspace opened for " + (state.branch?.name || state.branches[0]?.name || "selected branch") + ".";
  } catch (error) {
    message.textContent = error.message;
    throw error;
  }
}
function normalizeState(data = {}) {
  const arrayKeys = ["branches","staff","services","products","customers","bookings","sales","saleItems","branchHours","closedDates","discounts","inventoryStock","stockMovements","dailyClosings","staffRoster","staffRegularDaysOff"];
  const normalized = { ...data };
  arrayKeys.forEach((key) => { if (!Array.isArray(normalized[key])) normalized[key] = []; });
  return normalized;
}
function renderAll() { fillSelects(); renderMetrics(); renderBranches(); renderStaff(); renderServices(); renderProducts(); renderCustomers(); renderBookings(); renderSales(); renderInventory(); renderClosings(); renderReports(); renderRosterMonthCalendar(); renderRosterBranchBoard(); renderAccess(); renderClosingPreview(); }
function fillSelects() {
  const branchOptions = state.branches.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join("");
  const staffSelectOptions = '<option value="">Unassigned</option>' + state.staff.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join("");
  const customerOptions = '<option value="">Walk-in</option>' + state.customers.map((c) => '<option value="' + c.id + '">' + esc(c.first_name + " " + c.last_name) + '</option>').join("");
  const productOptions = '<option value="">Select product</option>' + (state.products || []).map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' - ' + money(p.price_cents) + '</option>').join("");
  const globalBranch = document.querySelector("#globalBranchFilter");
  if (globalBranch) {
    globalBranch.innerHTML = '<option value="">All branches</option>' + branchOptions;
    if (state.branches.some((branch) => branch.id === selectedGlobalBranchId)) globalBranch.value = selectedGlobalBranchId;
    else selectedGlobalBranchId = "";
  }
  const rosterBranch = document.querySelector("#rosterBranchSelect");
  if (rosterBranch) {
    rosterBranch.innerHTML = branchOptions;
    if (!state.branches.some((branch) => branch.id === selectedRosterBranchId)) selectedRosterBranchId = state.branches[0]?.id || "";
    rosterBranch.value = selectedRosterBranchId;
  }
  document.querySelectorAll('select[name="branchId"]').forEach((select) => select.innerHTML = branchOptions);
  document.querySelectorAll('select[data-optional-branch]').forEach((select) => select.innerHTML = '<option value="">Unassigned / all branches</option>' + branchOptions);
  const staffOptions = '<option value="">Select staff</option>' + state.staff.map((staff) => '<option value="' + esc(staff.id) + '">' + esc(staff.name) + '</option>').join("");
  document.querySelectorAll('select[data-staff-select]').forEach((select) => { const current = select.value; select.innerHTML = staffOptions; if (state.staff.some((staff) => staff.id === current)) select.value = current; });
  if (window.initialBranchId) {
    document.querySelectorAll('select[name="branchId"]').forEach((select) => select.value = window.initialBranchId);
  }
  document.querySelectorAll('select[name="staffId"]').forEach((select) => select.innerHTML = staffSelectOptions);
  document.querySelectorAll('select[name="customerId"]').forEach((select) => select.innerHTML = customerOptions);
  document.querySelectorAll('select[name="productId"]').forEach((select) => select.innerHTML = productOptions);
  document.querySelector("#customerList").innerHTML = state.customers.map((c) => '<option value="' + esc(customerLabel(c)) + '"></option>').join("");
  document.querySelector("#itemList").innerHTML = saleCatalog().map((item) => '<option value="' + esc(item.label) + '"></option>').join("");
  document.querySelector("#staffList").innerHTML = state.staff.map((s) => '<option value="' + esc(staffLabel(s)) + '"></option>').join("");
  renderBookingCheckoutOptions();
  document.querySelector("#bookingServiceList").innerHTML = state.services.filter((service) => service.status !== "Inactive").map((service) => '<option value="' + esc(bookingServiceLabel(service)) + '"></option>').join("");
  document.querySelectorAll(".staff-checks").forEach((box) => box.innerHTML = staffCheckboxes());
  renderCartSummary();
}
function localIsoDate(date = new Date()) {
  const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, "0"), day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}
function dashboardRange() {
  const today = new Date();
  let start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let end = new Date(start);
  if (selectedDashboardPeriod === "week") {
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset);
    end = new Date(start); end.setDate(start.getDate() + 6);
  } else if (selectedDashboardPeriod === "month") {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
    end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  } else if (selectedDashboardPeriod === "last-month") {
    start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    end = new Date(today.getFullYear(), today.getMonth(), 0);
  }
  return { start:localIsoDate(start), end:localIsoDate(end) };
}
function inDashboardRange(value, range) { const date = String(value || "").slice(0, 10); return date >= range.start && date <= range.end; }
function formatDashboardDate(value) { return new Date(String(value).slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day:"numeric", month:"long", year:"numeric" }); }
function uiIcon(name) { return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (window.uiIconPaths?.[name] || window.uiIconPaths?.dashboard || '') + '</svg>'; }
function salePaymentAmount(sale, type) {
  const method = String(sale.payment_method || "");
  const match = method.match(new RegExp(type + " \\\\$([0-9.]+)", "i"));
  if (match) return Math.round(Number(match[1]) * 100);
  return method.toLowerCase().includes(type.toLowerCase()) ? Number(sale.total_cents || 0) : 0;
}
function renderMetrics() {
  const range = dashboardRange();
  const branchMatches = (item) => !selectedGlobalBranchId || item.branch_id === selectedGlobalBranchId;
  const bookings = state.bookings.filter((booking) => branchMatches(booking) && inDashboardRange(booking.booking_date, range) && !["Cancelled","No show"].includes(booking.status));
  const sales = state.sales.filter((sale) => branchMatches(sale) && inDashboardRange(sale.created_at, range) && sale.status === "Paid");
  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
  const confirmed = bookings.filter((booking) => ["Confirmed","Completed"].includes(booking.status)).reduce((sum, booking) => sum + Number(booking.total_cents || 0), 0);
  const projected = bookings.filter((booking) => booking.payment_status !== "Paid").reduce((sum, booking) => sum + Number(booking.total_cents || 0), 0);
  const cash = sales.reduce((sum, sale) => sum + salePaymentAmount(sale, "cash"), 0);
  const card = sales.reduce((sum, sale) => sum + salePaymentAmount(sale, "card"), 0);
  const bank = sales.reduce((sum, sale) => sum + salePaymentAmount(sale, "bank transfer"), 0);
  const voucher = sales.reduce((sum, sale) => sum + salePaymentAmount(sale, "voucher"), 0);
  const rosterDate = selectedDashboardPeriod === "today" ? range.start : document.querySelector("#rosterDay").value || range.start;
  const roster = state.staffRoster.filter((entry) => entry.roster_date === rosterDate && entry.status === "Working" && branchMatches(entry));
  document.querySelector("#dashboardPeriodLabel").textContent = range.start === range.end ? formatDashboardDate(range.start) : formatDashboardDate(range.start) + " – " + formatDashboardDate(range.end);
  document.querySelector("#dashboardRosterDate").textContent = formatDashboardDate(rosterDate);
  const metricItems = [
    ["Total bookings", bookings.length, "calendar", "purple"], ["Confirmed revenue", money(confirmed), "money", "green"], ["Projected revenue", money(projected), "trend", "orange"], ["Total revenue", money(revenue), "money", "purple"],
    ["Cash", money(cash), "money", "green"], ["Card", money(card), "card", "blue"], ["Bank transfer", money(bank), "bank", "teal"], ["Voucher", money(voucher), "voucher", "pink"]
  ];
  document.querySelector("#metrics").innerHTML = metricItems.map(([label, value, icon, tone]) => '<article class="metric-card"><div class="metric-icon tone-' + tone + '">' + uiIcon(icon) + '</div><div><span>' + label + '</span><strong>' + value + '</strong></div></article>').join("");
  const chartHours = Array.from({ length:14 }, (_, index) => index + 7);
  const counts = chartHours.map((hour) => bookings.filter((booking) => Number(String(booking.booking_time || "").slice(0, 2)) === hour).length);
  const maxCount = Math.max(1, ...counts);
  document.querySelector("#bookingsChart").innerHTML = chartHours.map((hour, index) => {
    const count = counts[index], height = count ? Math.max(10, Math.round(count / maxCount * 100)) : 4;
    const label = hour === 12 ? "12pm" : hour > 12 ? (hour - 12) + "pm" : hour + "am";
    return '<div class="chart-hour" title="' + count + ' booking' + (count === 1 ? '' : 's') + '"><div class="chart-bar-wrap"><span class="chart-value">' + (count || '') + '</span><i style="height:' + height + '%"></i></div><span>' + label + '</span></div>';
  }).join("");
  const upcoming = state.bookings.filter((booking) => branchMatches(booking) && booking.booking_date >= localIsoDate() && !["Cancelled","No show","Completed"].includes(booking.status)).sort((a, b) => String(a.booking_date + a.booking_time).localeCompare(String(b.booking_date + b.booking_time))).slice(0, 5);
  document.querySelector("#dashboardUpcoming").innerHTML = upcoming.length ? upcoming.map((booking) => '<article><time>' + esc(String(booking.booking_time || "").slice(0, 5)) + '</time><div><strong>' + esc(booking.service_names || "Booking") + '</strong><span>' + esc(booking.customer_name || "Customer") + (selectedGlobalBranchId ? '' : ' · ' + esc(branchName(booking.branch_id))) + '</span></div><b></b></article>').join("") : '<p class="empty-state">No upcoming bookings.</p>';
  document.querySelector("#dashboardRoster").innerHTML = roster.length ? roster.map((entry) => {
    const staff = state.staff.find((item) => item.id === entry.staff_id);
    return '<article><div class="person-avatar">' + esc((staff?.name || "S").split(/\\s+/).map((part) => part[0]).join("").slice(0, 2)) + '</div><div><strong>' + esc(staff?.name || "Staff") + '</strong><span>' + esc((entry.start_time || "") + (entry.end_time ? "–" + entry.end_time : "")) + (selectedGlobalBranchId ? '' : ' · ' + esc(branchName(entry.branch_id))) + '</span></div></article>';
  }).join("") : '<p class="empty-state">No staff rostered for this day.</p>';
  const activityBranches = selectedGlobalBranchId ? state.branches.filter((branch) => branch.id === selectedGlobalBranchId) : state.branches;
  document.querySelector("#dashboardActivity").innerHTML = activityBranches.map((branch) => {
    const branchSales = sales.filter((sale) => sale.branch_id === branch.id);
    const total = branchSales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
    return '<article><div class="activity-icon">' + uiIcon("money") + '</div><div><strong>' + esc(branch.name) + '</strong><span>' + branchSales.length + ' sale' + (branchSales.length === 1 ? '' : 's') + ' · ' + money(total) + '</span></div><time>' + (selectedDashboardPeriod === 'today' ? 'Today' : 'Period') + '</time></article>';
  }).join("") || '<p class="empty-state">No activity in this period.</p>';
}
function renderBranches() {
  document.querySelector("#branchCards").innerHTML = state.branches.map((b) => '<article><div class="branch-card-top"><div class="branch-icon">' + esc(b.name.slice(0, 1)) + '</div><span class="pill">' + esc(b.status) + '</span></div><strong>' + esc(b.name) + '</strong><span>' + esc(b.address) + '</span><span>' + esc(b.phone) + '</span><button class="danger delete-branch" data-branch-id="' + esc(b.id) + '" type="button">Delete branch</button></article>').join("");
  document.querySelectorAll(".delete-branch").forEach((button) => button.addEventListener("click", deleteBranch));
  const detailSelect = document.querySelector("#branchDetailSelect");
  const current = detailSelect.value;
  detailSelect.innerHTML = state.branches.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join("");
  if (state.branches.some((b) => b.id === current)) detailSelect.value = current;
  renderBranchDetail();
}
function renderAccess() {
  const table = document.querySelector("#accessTable");
  if (!table) return;
  table.innerHTML = state.branches.map((branch) => '<tr><td><strong>' + esc(branch.name) + '</strong><div class="hint">' + esc(branch.address) + '</div></td><td><a class="branch-pos" href="/pos/' + esc(branch.id) + '">Open workspace</a></td><td><span class="pin-code">' + esc(branch.post_code || "Not set") + '</span></td><td><span class="pill">' + esc(branch.status) + '</span></td></tr>').join("") || '<tr><td colspan="4" class="empty-cell">No branches available.</td></tr>';
}
function renderBranchDetail() {
  const branchId = document.querySelector("#branchDetailSelect").value;
  const branch = state.branches.find((item) => item.id === branchId);
  const box = document.querySelector("#branchDetail");
  if (!branch) { box.innerHTML = '<p class="hint">Create or select a branch.</p>'; return; }
  const hours = (state.branchHours || []).filter((item) => item.branch_id === branchId).sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week));
  const closedDates = (state.closedDates || []).filter((item) => item.branch_id === branchId).sort((a, b) => String(a.closed_date).localeCompare(String(b.closed_date)));
  box.innerHTML = '<div class="branch-detail-heading"><div class="branch-icon">' + esc(branch.name.slice(0, 1)) + '</div><div><strong>' + esc(branch.name) + '</strong><span>' + esc(branch.address) + '</span><span>' + esc(branch.phone) + '</span></div><span class="pill">' + esc(branch.status) + '</span></div>' +
    '<h3>Opening timetable</h3><div class="timetable-list">' + (hours.length ? hours.map((item) => '<div><strong>' + dayName(item.day_of_week) + '</strong><span>' + (item.is_closed ? 'Closed' : esc(item.open_time + '–' + item.close_time)) + '</span></div>').join('') : '<p class="hint">No timetable saved.</p>') + '</div>' +
    '<h3>Upcoming closures</h3><div class="closure-list">' + (closedDates.length ? closedDates.map((item) => '<span class="closure-chip">' + esc(formatDashboardDate(item.closed_date)) + (item.reason ? ' · ' + esc(item.reason) : '') + '</span>').join('') : '<p class="hint">No closure dates set.</p>') + '</div>';
}
async function deleteBranch(event) {
  const branchId = event.currentTarget.dataset.branchId;
  const branch = state.branches.find((item) => item.id === branchId);
  if (!branch || !confirm('Delete ' + branch.name + '? Only branches without business records can be deleted.')) return;
  try { await api('/api/branches/' + encodeURIComponent(branchId), { method:'DELETE' }); message.textContent = 'Branch deleted.'; await loadData(); }
  catch (error) { message.textContent = error.message; }
}
function dayName(day) { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(day)] || ''; }
function staffDaysOff(staffId) { return state.staffRegularDaysOff.filter((item) => item.staff_id === staffId).map((item) => Number(item.day_of_week)); }
function dayOffLabel(staffId) { const days = staffDaysOff(staffId); return days.length ? days.map(dayName).join(", ") : "None set"; }
function dayOffChecksHtml(staffId = "") {
  const selected = staffDaysOff(staffId);
  return [[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"]].map(([value, label]) => '<label class="day-chip"><input type="checkbox" name="days" value="' + value + '"' + (selected.includes(value) ? ' checked' : '') + '><span>' + label + '</span></label>').join("");
}
function renderStaff() {
  document.querySelector("#staffTable").innerHTML = state.staff.map((staff) => '<tr class="staff-row" data-staff-id="' + esc(staff.id) + '" tabindex="0"><td><strong>' + esc(staff.name) + '</strong><div class="hint">' + esc(staff.email || staff.phone || "") + '</div></td><td>' + esc(staff.role || "") + '</td><td>' + esc(dayOffLabel(staff.id)) + '</td><td><span class="pill">' + esc(staff.status) + '</span></td><td><strong>' + money(staffSalesTotal(staff.id)) + '</strong></td></tr>').join("");
  document.querySelector("#staffForm [data-day-off-checks]").innerHTML = dayOffChecksHtml();
  document.querySelectorAll(".staff-row").forEach((row) => {
    row.addEventListener("click", () => openStaffProfile(row.dataset.staffId));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openStaffProfile(row.dataset.staffId); } });
  });
}
function staffSaleRows(staffId) {
  return (state.saleItems || []).map((item) => {
    let ids = [], allocations = [];
    try { ids = JSON.parse(item.staff_ids || "[]"); } catch (_) { ids = []; }
    try { allocations = JSON.parse(item.staff_allocations || "[]"); } catch (_) { allocations = []; }
    if (!ids.includes(staffId) && !allocations.some((entry) => entry.staffId === staffId)) return null;
    const allocation = allocations.find((entry) => entry.staffId === staffId);
    let credit = Number(allocation?.amountCents || 0);
    if (!credit && Number(allocation?.percent || 0)) credit = Math.round(Number(item.price_cents || 0) * Number(allocation.percent) / 100);
    if (!credit) credit = Math.round(Number(item.price_cents || 0) / Math.max(ids.length, 1));
    return { ...item, credit };
  }).filter(Boolean);
}
function staffSalesTotal(staffId) { return staffSaleRows(staffId).reduce((sum, item) => sum + item.credit, 0); }
function openStaffProfile(staffId) {
  const staff = state.staff.find((item) => item.id === staffId);
  if (!staff) return;
  const form = document.querySelector("#staffProfileForm");
  form.elements.staffId.value = staff.id;
  form.elements.name.value = staff.name;
  form.elements.role.value = staff.role || "";
  form.elements.email.value = staff.email || "";
  form.elements.phone.value = staff.phone || "";
  form.elements.status.value = staff.status || "Active";
  form.querySelector("[data-day-off-checks]").innerHTML = dayOffChecksHtml(staffId);
  const rows = staffSaleRows(staffId);
  document.querySelector("#staffProfileTitle").textContent = staff.name;
  document.querySelector("#staffProfileSummary").textContent = rows.length + " service sale" + (rows.length === 1 ? "" : "s") + " · " + money(staffSalesTotal(staffId)) + " credited sales";
  document.querySelector("#staffSalesTable").innerHTML = rows.length ? rows.map((item) => '<tr><td>' + esc(formatCustomerDate(item.created_at)) + '</td><td>' + esc(item.branch_name || branchName(item.branch_id)) + '</td><td>' + esc(item.item_name) + '</td><td>' + money(item.price_cents) + '</td><td><strong>' + money(item.credit) + '</strong></td></tr>').join("") : '<tr><td colspan="5" class="empty-cell">No credited sales yet.</td></tr>';
  document.querySelector("#staffProfile").classList.remove("hidden");
  document.querySelector("#staffProfile").scrollIntoView({ behavior:"smooth", block:"start" });
}
async function submitStaffForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const days = [...form.querySelectorAll('input[name="days"]:checked')].map((input) => Number(input.value));
  try {
    message.textContent = "Saving staff...";
    const result = await api("/api/staff", { method:"POST", body:JSON.stringify(data) });
    await api("/api/staff-regular-days-off", { method:"POST", body:JSON.stringify({ staffId:result.id, days }) });
    form.reset(); await loadData(); message.textContent = "Staff member saved.";
  } catch (error) { message.textContent = error.message; }
}
async function submitStaffProfile(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const staffId = data.staffId;
  const days = [...event.currentTarget.querySelectorAll('input[name="days"]:checked')].map((input) => Number(input.value));
  try { message.textContent = "Saving staff details..."; await api("/api/staff/" + encodeURIComponent(staffId), { method:"PATCH", body:JSON.stringify(data) }); await api("/api/staff-regular-days-off", { method:"POST", body:JSON.stringify({ staffId, days }) }); await loadData(); openStaffProfile(staffId); message.textContent = "Staff details and day off saved."; }
  catch (error) { message.textContent = error.message; }
}
function closeStaffProfile() { document.querySelector("#staffProfile").classList.add("hidden"); }
function setInitialRosterWeek() {
  const today = new Date().toISOString().slice(0, 10);
  document.querySelector("#rosterMonth").value = today.slice(0, 7);
  document.querySelector("#rosterDay").value = today;
}
function renderRosterMonthCalendar() {
  const value = document.querySelector("#rosterMonth").value;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return;
  const year = Number(match[1]), month = Number(match[2]) - 1;
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const selectedDate = document.querySelector("#rosterDay").value;
  const headings = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => '<div class="month-weekday">' + day + '</div>').join("");
  const blanks = Array.from({ length:firstDay }, () => '<div class="month-blank"></div>').join("");
  const days = Array.from({ length:daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = value + "-" + String(day).padStart(2, "0");
    const branchMatches = (item) => item.branch_id === selectedRosterBranchId;
    const bookings = state.bookings.filter((booking) => booking.booking_date === date && branchMatches(booking) && !["Cancelled","No show"].includes(booking.status)).length;
    const rostered = state.staffRoster.filter((entry) => entry.roster_date === date && branchMatches(entry) && entry.status === "Working").length;
    return '<button class="month-day' + (date === selectedDate ? ' selected' : '') + '" type="button" data-date="' + date + '"><strong>' + day + '</strong><span>' + bookings + ' booking' + (bookings === 1 ? '' : 's') + '</span><span>' + rostered + ' staff rostered</span></button>';
  }).join("");
  document.querySelector("#rosterMonthCalendar").innerHTML = headings + blanks + days;
  document.querySelectorAll(".month-day").forEach((button) => button.addEventListener("click", () => { document.querySelector("#rosterDay").value = button.dataset.date; renderRosterMonthCalendar(); renderRosterBranchBoard(); document.querySelector("#rosterBranchBoard").scrollIntoView({ behavior:"smooth", block:"center" }); }));
}
function renderRosterBranchBoard() {
  const date = document.querySelector("#rosterDay").value;
  if (!date) return;
  const branch = state.branches.find((item) => item.id === selectedRosterBranchId);
  const board = document.querySelector("#rosterBranchBoard");
  if (!branch) { document.querySelector("#rosterDayTitle").textContent = "Branch roster"; board.innerHTML = '<p class="empty-state">Create a branch before building the roster.</p>'; return; }
  document.querySelector("#rosterDayTitle").textContent = branch.name + " roster · " + new Date(date + "T00:00:00").toLocaleDateString("en-AU", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const activeStaff = state.staff.filter((staff) => staff.status !== "Inactive");
  const entries = state.staffRoster.filter((entry) => entry.roster_date === date && entry.branch_id === branch.id && entry.status === "Working");
  const bookings = state.bookings.filter((booking) => booking.booking_date === date && booking.branch_id === branch.id && !["Cancelled","No show"].includes(booking.status));
  const assignedIds = new Set(state.staffRoster.filter((entry) => entry.roster_date === date && entry.status === "Working").map((entry) => entry.staff_id));
  const options = activeStaff.filter((staff) => !assignedIds.has(staff.id)).map((staff) => '<option value="' + esc(staff.id) + '">' + esc(staff.name) + '</option>').join("");
  const rows = entries.map((entry) => '<div class="roster-person" data-staff-id="' + esc(entry.staff_id) + '" data-date="' + esc(date) + '" data-branch-id="' + esc(branch.id) + '"><div class="roster-person-name"><div class="person-avatar">' + esc((state.staff.find((staff) => staff.id === entry.staff_id)?.name || "S").split(/\\s+/).map((part) => part[0]).join("").slice(0, 2)) + '</div><div><strong>' + esc(state.staff.find((staff) => staff.id === entry.staff_id)?.name || "Staff") + '</strong><span>' + esc(state.staff.find((staff) => staff.id === entry.staff_id)?.role || "") + '</span></div></div><label><span>Start</span><input name="startTime" type="time" value="' + esc(entry.start_time || "09:00") + '"></label><label><span>Finish</span><input name="endTime" type="time" value="' + esc(entry.end_time || "17:30") + '"></label><div class="roster-row-actions"><button class="secondary save-roster-row" type="button">Save</button><button class="icon-danger remove-roster-row" type="button" aria-label="Remove from roster">×</button></div></div>').join("");
  board.innerHTML = '<article class="roster-branch-card"><div class="branch-roster-heading"><div><h3>' + esc(branch.name) + '</h3><span>' + esc(branch.address || "") + '</span></div><div class="roster-day-stats"><span>' + entries.length + ' staff</span><strong>' + bookings.length + ' booking' + (bookings.length === 1 ? '' : 's') + '</strong></div></div><div class="roster-table-head"><span>Staff member</span><span>Start</span><span>Finish</span><span>Actions</span></div><div class="roster-assigned">' + (rows || '<p class="empty-state roster-empty">No staff assigned for this day.</p>') + '</div><div class="branch-assign-row"><label><span>Staff member</span><select aria-label="Staff to assign"><option value="">Choose staff</option>' + options + '</select></label><label><span>Start</span><input name="startTime" type="time" value="09:00"></label><label><span>Finish</span><input name="endTime" type="time" value="17:30"></label><button class="primary assign-roster-staff" type="button" data-branch-id="' + esc(branch.id) + '" data-date="' + esc(date) + '">Add shift</button></div></article>';
  document.querySelectorAll(".assign-roster-staff").forEach((button) => button.addEventListener("click", assignStaffToBranch));
  document.querySelectorAll(".save-roster-row").forEach((button) => button.addEventListener("click", saveRosterRow));
  document.querySelectorAll(".remove-roster-row").forEach((button) => button.addEventListener("click", removeRosterRow));
}
async function assignStaffToBranch(event) {
  const button = event.currentTarget;
  const row = button.parentElement;
  const staffId = row.querySelector("select").value;
  if (!staffId) { message.textContent = "Choose a staff member first."; return; }
  try {
    message.textContent = "Assigning staff...";
    await api("/api/staff-roster", { method:"POST", body:JSON.stringify({ staffId, rosterDate:button.dataset.date, status:"Working", branchId:button.dataset.branchId, startTime:row.querySelector('input[name="startTime"]').value, endTime:row.querySelector('input[name="endTime"]').value, notes:"" }) });
    await loadData();
    message.textContent = "Staff assigned to branch.";
  } catch (error) { message.textContent = error.message; }
}
async function saveRosterRow(event) {
  const row = event.currentTarget.closest(".roster-person");
  try {
    message.textContent = "Saving shift...";
    await api("/api/staff-roster", { method:"POST", body:JSON.stringify({ staffId:row.dataset.staffId, rosterDate:row.dataset.date, branchId:row.dataset.branchId, status:"Working", startTime:row.querySelector('input[name="startTime"]').value, endTime:row.querySelector('input[name="endTime"]').value, notes:"" }) });
    await loadData(); message.textContent = "Shift updated.";
  } catch (error) { message.textContent = error.message; }
}
async function removeRosterRow(event) {
  const row = event.currentTarget.closest(".roster-person");
  try {
    message.textContent = "Removing shift...";
    await api("/api/staff-roster?staffId=" + encodeURIComponent(row.dataset.staffId) + "&rosterDate=" + encodeURIComponent(row.dataset.date), { method:"DELETE" });
    await loadData(); message.textContent = "Shift removed.";
  } catch (error) { message.textContent = error.message; }
}
function renderServices() {
  const categoryOrder = ["Special for limited time", "Threading", "Eye treatment", "Waxing", "Bleach", "Facial", "Makeup & hairstyle", "Hair cut", "Hair color", "Treatment", "Keratin", "Permanent", "Temporary"];
  const categories = [...new Set(state.services.map((service) => service.category || "General"))].sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
    if (leftIndex >= 0) return -1;
    if (rightIndex >= 0) return 1;
    return left.localeCompare(right);
  });
  document.querySelector("#serviceCategories").innerHTML = categories.map((category) => '<option value="' + esc(category) + '"></option>').join("");
  document.querySelector("#serviceCategoriesList").innerHTML = categories.map((category) => {
    const services = state.services.filter((service) => (service.category || "General") === category);
    return '<section class="service-category" data-category="' + esc(category) + '"><div class="category-heading"><h3>' + esc(category) + '</h3><span>' + services.length + ' services</span></div><div class="cards service-drop-zone">' + services.map((service) => '<article class="service-card ' + (service.status === "Inactive" ? "service-inactive" : "") + '" draggable="true" data-service-id="' + esc(service.id) + '"><button class="edit-service" data-service-id="' + esc(service.id) + '" type="button" title="Edit service" aria-label="Edit ' + esc(service.name) + '">✎</button><strong>' + esc(service.name) + '</strong><span>' + service.duration_minutes + ' min · ' + esc(service.status) + '</span><em>' + money(service.price_cents) + '</em></article>').join("") + '</div></section>';
  }).join("");
  document.querySelectorAll(".edit-service").forEach((button) => button.addEventListener("click", editService));
  document.querySelectorAll(".service-card").forEach((card) => {
    card.addEventListener("dragstart", startServiceDrag);
    card.addEventListener("dragend", endServiceDrag);
  });
  document.querySelectorAll(".service-category").forEach((section) => {
    section.addEventListener("dragover", allowServiceDrop);
    section.addEventListener("dragleave", leaveServiceDrop);
    section.addEventListener("drop", dropService);
  });
}
function editService(event) {
  event.stopPropagation();
  const service = state.services.find((item) => item.id === event.currentTarget.dataset.serviceId);
  if (!service) return;
  const form = document.querySelector("#serviceForm");
  form.elements.serviceId.value = service.id;
  form.elements.name.value = service.name;
  form.elements.category.value = service.category;
  form.elements.durationMinutes.value = service.duration_minutes;
  form.elements.price.value = (Number(service.price_cents || 0) / 100).toFixed(2);
  form.elements.status.value = service.status || "Active";
  form.elements.category.readOnly = true;
  document.querySelector("#serviceFormTitle").textContent = "Edit service";
  document.querySelector("#serviceSaveButton").textContent = "Update service";
  document.querySelector("#cancelServiceEdit").classList.remove("hidden");
  form.scrollIntoView({ behavior:"smooth", block:"start" });
}
function resetServiceForm() {
  const form = document.querySelector("#serviceForm");
  form.reset();
  form.elements.serviceId.value = "";
  form.elements.category.readOnly = false;
  document.querySelector("#serviceFormTitle").textContent = "Add service";
  document.querySelector("#serviceSaveButton").textContent = "Save service";
  document.querySelector("#cancelServiceEdit").classList.add("hidden");
}
async function submitServiceForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const serviceId = payload.serviceId;
  try {
    message.textContent = serviceId ? "Updating service..." : "Saving service...";
    await api(serviceId ? "/api/services/" + encodeURIComponent(serviceId) : "/api/services", { method:serviceId ? "PATCH" : "POST", body:JSON.stringify(payload) });
    resetServiceForm();
    await loadData();
    message.textContent = serviceId ? "Service updated." : "Service added.";
  } catch (error) { message.textContent = error.message; }
}
function startServiceDrag(event) {
  draggedServiceId = event.currentTarget.dataset.serviceId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedServiceId);
  event.currentTarget.classList.add("dragging");
}
function endServiceDrag(event) {
  event.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".service-category.drag-over").forEach((section) => section.classList.remove("drag-over"));
  draggedServiceId = "";
}
function allowServiceDrop(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  event.currentTarget.classList.add("drag-over");
}
function leaveServiceDrop(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove("drag-over");
}
async function dropService(event) {
  event.preventDefault();
  const section = event.currentTarget;
  section.classList.remove("drag-over");
  const serviceId = draggedServiceId || event.dataTransfer.getData("text/plain");
  const service = state.services.find((item) => item.id === serviceId);
  const category = section.dataset.category;
  if (!service || !category || service.category === category) return;
  try {
    message.textContent = "Moving " + service.name + " to " + category + "...";
    await api("/api/services/" + encodeURIComponent(service.id), { method:"PATCH", body:JSON.stringify({ name:service.name, category, durationMinutes:service.duration_minutes, price:Number(service.price_cents || 0) / 100, status:service.status }) });
    await loadData();
    message.textContent = service.name + " moved to " + category + ".";
  } catch (error) { message.textContent = error.message; }
}
function renderProducts() { document.querySelector("#productCards").innerHTML = (state.products || []).map((p) => '<article><strong>' + esc(p.name) + '</strong><span>' + esc(p.category) + ' - SKU ' + esc(p.sku || "") + '</span><em>' + money(p.price_cents) + '</em></article>').join(""); }
function renderCustomers() {
  document.querySelector("#customersTable").innerHTML = state.customers.map((c) => '<tr class="customer-row" data-customer-id="' + esc(c.id) + '" tabindex="0"><td><strong>' + esc(c.first_name + " " + c.last_name) + '</strong></td><td>' + esc(c.email) + '</td><td>' + esc(c.phone) + '</td><td>' + esc(c.tags || "") + '</td></tr>').join("");
  document.querySelectorAll(".customer-row").forEach((row) => {
    row.addEventListener("click", () => openCustomerProfile(row.dataset.customerId));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openCustomerProfile(row.dataset.customerId); } });
  });
}
function openCustomerProfile(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return;
  const form = document.querySelector("#customerProfileForm");
  form.elements.customerId.value = customer.id;
  form.elements.firstName.value = customer.first_name || "";
  form.elements.lastName.value = customer.last_name || "";
  form.elements.email.value = customer.email || "";
  form.elements.phone.value = customer.phone || "";
  form.elements.branchId.value = customer.branch_id || "";
  form.elements.tags.value = customer.tags || "";
  form.elements.notes.value = customer.notes || "";
  const sales = state.sales.filter((sale) => sale.customer_id === customer.id);
  const spent = sales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
  document.querySelector("#customerProfileTitle").textContent = customer.first_name + " " + customer.last_name;
  document.querySelector("#customerProfileSummary").textContent = sales.length + " sale" + (sales.length === 1 ? "" : "s") + " · " + money(spent) + " total spent";
  const saleById = Object.fromEntries(sales.map((sale) => [sale.id, sale]));
  const history = (state.saleItems || []).filter((item) => saleById[item.sale_id]);
  document.querySelector("#customerHistoryTable").innerHTML = history.length ? history.map((item) => {
    const sale = saleById[item.sale_id];
    return '<tr><td>' + esc(formatCustomerDate(sale.created_at)) + '</td><td><strong>' + esc(item.branch_name || sale.branch_name || "") + '</strong></td><td>' + esc(item.item_name) + '</td><td>' + esc(customerSaleStaff(item)) + '</td><td>' + money(item.price_cents) + '</td><td>' + esc(sale.payment_method || "") + '</td></tr>';
  }).join("") : '<tr><td colspan="6" class="empty-cell">No sales recorded for this customer yet.</td></tr>';
  document.querySelector("#customerProfile").classList.remove("hidden");
  document.querySelector("#customerProfile").scrollIntoView({ behavior:"smooth", block:"start" });
}
function customerSaleStaff(item) {
  let ids = [];
  try { ids = JSON.parse(item.staff_ids || "[]"); } catch (_) { ids = []; }
  return ids.map((id) => state.staff.find((staff) => staff.id === id)?.name).filter(Boolean).join(", ") || "—";
}
function formatCustomerDate(value) { return value ? new Date(value).toLocaleString("en-AU", { dateStyle:"medium", timeStyle:"short" }) : ""; }
function closeCustomerProfile() { document.querySelector("#customerProfile").classList.add("hidden"); }
function showTab(tabId) {
  document.querySelectorAll(".nav,.tab").forEach((item) => item.classList.remove("active"));
  document.querySelector('.nav[data-tab="' + cssEsc(tabId) + '"]')?.classList.add("active");
  document.querySelector("#" + tabId)?.classList.add("active");
  document.querySelector(".branch-switcher")?.classList.toggle("hidden", tabId !== "overview");
  const titles = { overview:"Dashboard", customers:"Customers", staff:"Staff", roster:"Roster", services:"Services", products:"Products", inventory:"Inventory", reports:"Reports", branches:"Branches", access:"Access", pos:"POS", bookings:"Bookings", closing:"Daily closing", "recent-sales":"Recent sales" };
  if (document.querySelector("#appTitle")) document.querySelector("#appTitle").textContent = titles[tabId] || "Kunchas";
}
function canCheckoutBooking(booking) {
  return !booking.sale_id && booking.payment_status !== "Paid" && !["Cancelled", "No show"].includes(booking.status);
}
function renderBookingCheckoutOptions() {
  const select = document.querySelector("#bookingCheckout");
  const currentValue = select.value;
  const options = state.bookings.filter(canCheckoutBooking).map((booking) =>
    '<option value="' + esc(booking.id) + '">' + esc(booking.booking_date + " " + booking.booking_time + " — " + booking.customer_name + " — " + booking.service_names + " — " + money(booking.total_cents)) + '</option>'
  ).join("");
  select.innerHTML = '<option value="">New walk-in sale</option>' + options;
  if ([...select.options].some((option) => option.value === currentValue)) select.value = currentValue;
}
function selectBookingForCheckout() {
  const form = document.querySelector("#saleForm");
  const booking = state.bookings.find((item) => item.id === document.querySelector("#bookingCheckout").value);
  form.elements.bookingId.value = booking?.id || "";
  if (!booking) {
    document.querySelector(".booking-checkout-hint").textContent = "Choose an unpaid booking to preload its customer, services, and assigned staff.";
    return;
  }
  const customer = state.customers.find((item) => item.id === booking.customer_id);
  form.elements.customerMode.value = "existing";
  form.elements.customerSearch.value = customer ? customerLabel(customer) : "";
  updateCustomerMode();
  document.querySelector("#saleItems").innerHTML = "";
  parseClientIdList(booking.service_ids).forEach((serviceId) => {
    const service = saleCatalog().find((item) => item.type === "service" && item.id === serviceId);
    if (service) addSaleItem(service, booking.staff_id || "");
  });
  if (!document.querySelector("#saleItems").children.length) addSaleItem();
  form.elements.cashAmount.value = "";
  form.elements.cardAmount.value = "";
  document.querySelector(".booking-checkout-hint").textContent = booking.customer_name + " — " + booking.service_names + " — " + money(booking.total_cents);
  renderCartSummary();
  message.textContent = "Booking loaded. Enter payment to complete checkout.";
}
function checkoutBookingFromRow(event) {
  const bookingId = event.target.closest("tr").dataset.bookingId;
  showTab("pos");
  document.querySelector("#bookingCheckout").value = bookingId;
  selectBookingForCheckout();
  document.querySelector("#saleForm").scrollIntoView({ behavior:"smooth", block:"start" });
}
function parseClientIdList(value) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function renderBookings() {
  document.querySelector("#bookingsTable").innerHTML = state.bookings.map((b) =>
    '<tr data-booking-id="' + esc(b.id) + '"><td><input name="bookingDate" type="date" value="' + esc(b.booking_date) + '"><input name="bookingTime" type="time" value="' + esc(b.booking_time) + '"></td><td><strong>' + esc(b.customer_name) + '</strong><div class="hint">' + esc(b.notes || "") + '</div></td><td><select name="staffId">' + staffSelectOptions(b.staff_id) + '</select></td><td>' + esc(b.service_names) + '<div class="hint">' + esc(b.payment_status) + '</div></td><td><select name="status"><option' + selected(b.status, "Booked") + '>Booked</option><option' + selected(b.status, "Confirmed") + '>Confirmed</option><option' + selected(b.status, "Completed") + '>Completed</option><option' + selected(b.status, "Cancelled") + '>Cancelled</option><option' + selected(b.status, "No show") + '>No show</option></select></td><td><button class="secondary save-booking" type="button">Save</button>' + (canCheckoutBooking(b) ? '<button class="primary checkout-booking" type="button">Checkout in POS</button>' : '') + '</td></tr>'
  ).join("");
  document.querySelectorAll(".save-booking").forEach((button) => button.addEventListener("click", saveBookingRow));
  document.querySelectorAll(".checkout-booking").forEach((button) => button.addEventListener("click", checkoutBookingFromRow));
}
function renderSales() { document.querySelector("#salesTable").innerHTML = state.sales.map((s) => '<tr><td>' + esc(s.branch_name) + '</td><td>' + money(s.total_cents) + '</td><td>' + esc(s.payment_method) + '</td><td><span class="pill">' + esc(s.status) + '</span></td></tr>').join(""); }
function inventoryRows() {
  return state.branches.flatMap((branch) => (state.products || []).map((product) => {
    const stock = (state.inventoryStock || []).find((item) => item.branch_id === branch.id && item.product_id === product.id);
    return { branch_id:branch.id, branch_name:branch.name, product_id:product.id, product_name:product.name, sku:product.sku, quantity:Number(stock?.quantity || 0), low_stock_level:Number(stock?.low_stock_level || 3) };
  }));
}
function inventoryMatrixMarkup() {
  const head = '<tr><th>Product</th><th>SKU</th>' + state.branches.map((branch) => '<th>' + esc(branch.name) + '</th>').join('') + '<th>Total</th></tr>';
  const body = (state.products || []).map((product) => {
    const quantities = state.branches.map((branch) => inventoryRows().find((row) => row.branch_id === branch.id && row.product_id === product.id)?.quantity || 0);
    return '<tr><td><strong>' + esc(product.name) + '</strong></td><td>' + esc(product.sku || '') + '</td>' + quantities.map((qty) => '<td>' + qty + '</td>').join('') + '<td><strong>' + quantities.reduce((sum, qty) => sum + qty, 0) + '</strong></td></tr>';
  }).join('');
  return { head, body };
}
function renderInventory() {
  const matrix = inventoryMatrixMarkup();
  document.querySelector("#inventoryHead").innerHTML = matrix.head;
  document.querySelector("#inventoryTable").innerHTML = matrix.body;
}
function renderClosings() {
  document.querySelector("#closingTable").innerHTML = (state.dailyClosings || []).map((c) => '<tr><td>' + esc(c.closing_date) + '</td><td>' + esc(c.branch_name) + '<div class="hint">Yesterday ' + money(c.previous_cash_cents || 0) + '</div></td><td>' + money(c.cash_taken_cents || 0) + '</td><td>' + money(c.remaining_cash_cents ?? c.actual_cash_cents) + '<div class="hint">Variance ' + money(c.cash_variance_cents) + '</div></td><td><span class="pill">' + esc(c.status) + '</span></td></tr>').join("");
  document.querySelector("#adminClosingTable").innerHTML = (state.dailyClosings || []).map((c) => '<tr data-closing-id="' + esc(c.id) + '"><td>' + esc(c.closing_date) + '</td><td>' + esc(c.branch_name) + '<div class="hint">Yesterday ' + money(c.previous_cash_cents || 0) + ' / sales cash ' + money(c.expected_cash_cents) + ' / card ' + money(c.expected_card_cents) + '</div></td><td><input name="actualCash" type="number" min="0" step="0.01" value="' + dollars(c.actual_cash_cents) + '"><div class="hint">Variance ' + money(c.cash_variance_cents) + '</div></td><td><input name="cashTaken" type="number" min="0" step="0.01" value="' + dollars(c.cash_taken_cents || 0) + '"><div class="hint">Remaining ' + money(c.remaining_cash_cents ?? c.actual_cash_cents) + '</div></td><td><input name="actualCard" type="number" min="0" step="0.01" value="' + dollars(c.actual_card_cents) + '"><div class="hint">Variance ' + money(c.card_variance_cents) + '</div></td><td><select name="status"><option' + selected(c.status, "Balanced") + '>Balanced</option><option' + selected(c.status, "Variance") + '>Variance</option><option' + selected(c.status, "Manager Review") + '>Manager Review</option><option' + selected(c.status, "Approved") + '>Approved</option></select></td><td><input name="approvedBy" value="' + esc(c.approved_by || "") + '" placeholder="Manager"><textarea name="notes" placeholder="Notes">' + esc(c.notes || "") + '</textarea></td><td><button class="secondary save-closing" type="button">Save</button></td></tr>').join("");
  document.querySelectorAll(".save-closing").forEach((button) => button.addEventListener("click", saveClosingRow));
}
function renderReports() {
  const revenue = state.sales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
  const lowStock = (state.inventoryStock || []).filter((item) => Number(item.quantity) <= Number(item.low_stock_level)).length;
  document.querySelector("#reportMetrics").innerHTML = [["Sales", money(revenue)], ["Transactions", state.sales.length], ["Bookings", state.bookings.length], ["Customers", state.customers.length], ["Low stock", lowStock]].map(([label, value]) => '<article><span>' + label + '</span><strong>' + value + '</strong></article>').join("");
  document.querySelector("#reportCards").innerHTML = state.branches.map((branch) => {
    const branchSales = state.sales.filter((sale) => sale.branch_id === branch.id);
    const branchRevenue = branchSales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
    const closing = (state.dailyClosings || []).find((item) => item.branch_id === branch.id);
    return '<article><strong>' + esc(branch.name) + '</strong><span>' + branchSales.length + ' transactions</span><em>' + money(branchRevenue) + ' / Closing ' + esc(closing?.status || "Open") + '</em></article>';
  }).join("");
  const matrix = inventoryMatrixMarkup();
  document.querySelector("#reportInventoryHead").innerHTML = matrix.head;
  document.querySelector("#reportInventoryTable").innerHTML = matrix.body;
}
function addSaleItem(selectedItem = null, selectedStaffId = "") {
  const row = document.createElement("div");
  row.className = "sale-item";
  row.innerHTML = '<label>Service / product search<input name="saleItemSearch" list="itemList" required placeholder="Type service or product"></label><div class="line-meta"></div><div class="instance-edit hidden"><div class="grid"><label>Name for this sale<input name="instanceName"></label><label>Amount for this sale $<input name="instancePrice" type="number" min="0.01" step="0.01"></label></div><p class="hint">Only this sale and receipt change. The master service stays the same.</p></div><div class="staff-area"><span class="field-label">Staff involved</span><div class="staff-add-row"><input name="saleStaffSearch" list="staffList" placeholder="Type staff name, phone, or email"><button class="secondary add-staff" type="button">Add</button></div><div class="selected-staff"></div><p class="hint allocation-summary">Staff percentages: 0% · Staff dollars: $0.00</p></div>';
  document.querySelector("#saleItems").append(row);
  row.querySelector(".add-staff").addEventListener("click", () => addStaffToSaleItem(row));
  row.querySelector('input[name="saleItemSearch"]').addEventListener("input", () => updateSaleItemRow(row));
  row.querySelector('input[name="instanceName"]').addEventListener("input", renderCartSummary);
  row.querySelector('input[name="instancePrice"]').addEventListener("input", () => { updateAllocationSummary(row); renderCartSummary(); });
  if (selectedItem) row.querySelector('input[name="saleItemSearch"]').value = selectedItem.label;
  updateSaleItemRow(row);
  if (selectedStaffId && selectedItem?.type === "service") {
    const staff = state.staff.find((item) => item.id === selectedStaffId);
    if (staff) {
      row.querySelector('input[name="saleStaffSearch"]').value = staffLabel(staff);
      addStaffToSaleItem(row);
    }
  }
}
function bookingServiceLabel(service) { return service.name + " | " + service.category + " | " + money(service.price_cents); }
function addBookingService() {
  const input = document.querySelector("#bookingServiceSearch");
  const service = state.services.find((item) => bookingServiceLabel(item) === input.value);
  if (!service) { message.textContent = "Select a service from the search list."; return; }
  if (document.querySelector('#bookingSelectedServices input[value="' + cssEsc(service.id) + '"]')) { input.value = ""; return; }
  const row = document.createElement("div");
  row.className = "booking-service-row";
  row.innerHTML = '<input type="hidden" name="serviceIds" value="' + esc(service.id) + '"><span><strong>' + esc(service.name) + '</strong><em>' + esc(service.category) + '</em></span><b>' + money(service.price_cents) + '</b><button type="button" aria-label="Remove ' + esc(service.name) + '">×</button>';
  row.querySelector("button").addEventListener("click", () => { row.remove(); renderBookingServiceTotal(); });
  document.querySelector("#bookingSelectedServices").append(row);
  input.value = "";
  renderBookingServiceTotal();
}
function renderBookingServiceTotal() {
  const total = [...document.querySelectorAll('#bookingSelectedServices input[name="serviceIds"]')].reduce((sum, input) => sum + Number(state.services.find((service) => service.id === input.value)?.price_cents || 0), 0);
  document.querySelector("#bookingServiceTotal").textContent = money(total);
}
async function submitCustomer(event) { event.preventDefault(); await submitJson("/api/customers", Object.fromEntries(new FormData(event.target)), event.target); }
async function submitCustomerProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const customerId = data.customerId;
  try {
    message.textContent = "Saving customer details...";
    await api("/api/customers/" + encodeURIComponent(customerId), { method:"PATCH", body:JSON.stringify(data) });
    await loadData();
    openCustomerProfile(customerId);
    message.textContent = "Customer details saved.";
  } catch (error) { message.textContent = error.message; }
}
async function submitBooking(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  if (!data.getAll("serviceIds").length) { message.textContent = "Add at least one service to the booking."; return; }
  await submitJson("/api/branch-bookings", { customer:{ firstName:data.get("firstName"), lastName:data.get("lastName"), email:data.get("email"), phone:data.get("phone") }, branchId:data.get("branchId"), staffId:data.get("staffId"), bookingDate:data.get("bookingDate"), bookingTime:data.get("bookingTime"), serviceIds:data.getAll("serviceIds"), notes:data.get("notes") }, event.target);
}
async function submitAdminForm(event, path) { event.preventDefault(); await submitJson(path, Object.fromEntries(new FormData(event.target)), event.target); }
async function submitSale(event) {
  event.preventDefault();
  const data = new FormData(event.target);
  const customerMode = data.get("customerMode");
  const customerId = customerMode === "existing" ? findCustomerId(data.get("customerSearch")) : "";
  if (customerMode === "existing" && !customerId) {
    message.textContent = "Select an existing customer from the dropdown, or choose walking customer.";
    return;
  }
  if (customerMode === "new" && (!data.get("newFirstName") || !data.get("newLastName") || (!data.get("newPhone") && !data.get("newEmail")))) {
    message.textContent = "New customer needs first name, last name, and phone or email.";
    return;
  }
  const items = [...event.target.querySelectorAll(".sale-item")].map((row) => {
    const selectedItem = findSaleItem(row.querySelector('input[name="saleItemSearch"]').value);
    if (!selectedItem) return null;
    return {
      itemType: selectedItem.type,
      itemId: selectedItem.id,
      instanceName: selectedItem.type === "service" ? row.querySelector('input[name="instanceName"]').value : "",
      instancePrice: selectedItem.type === "service" ? row.querySelector('input[name="instancePrice"]').value : "",
      staffIds: selectedItem.type === "service" ? [...row.querySelectorAll('input[name="saleStaffIds"]:checked')].map((input) => input.value) : [],
      staffAllocations: selectedItem.type === "service" ? [...row.querySelectorAll(".staff-chip")].map((chip) => ({
        staffId: chip.querySelector('input[name="saleStaffIds"]').value,
        percent: chip.querySelector('input[name="staffPercent"]').value,
        amount: chip.querySelector('input[name="staffAmount"]').value
      })) : []
    };
  }).filter(Boolean);
  for (const row of event.target.querySelectorAll(".sale-item")) {
    const error = allocationError(row);
    if (error) { message.textContent = error; return; }
  }
  await submitJson("/api/sales", {
    branchId:data.get("branchId"),
    bookingId:data.get("bookingId"),
    customerMode,
    customerId,
    customerCategory:data.get("customerCategory"),
    newCustomer:{ firstName:data.get("newFirstName"), lastName:data.get("newLastName"), phone:data.get("newPhone"), email:data.get("newEmail") },
    cashAmount:data.get("cashAmount"),
    cardAmount:data.get("cardAmount"),
    items
  }, event.target);
}
async function submitJson(path, payload, form) {
  try {
    message.textContent = "Saving...";
    const result = await api(path, { method:"POST", body:JSON.stringify(payload) });
    if (result.receipt) {
      lastReceipt = result.receipt;
      document.querySelector("#printReceipt").classList.remove("hidden");
    }
    form.reset();
    if (form.id === "saleForm") { document.querySelector("#saleItems").innerHTML = ""; document.querySelector("#bookingCheckout").value = ""; addSaleItem(); updateCustomerMode(); }
    if (form.id === "bookingForm") { document.querySelector("#bookingSelectedServices").innerHTML = ""; renderBookingServiceTotal(); }
    if (path === "/api/sales" || path === "/api/branch-bookings" || path === "/api/daily-closing") await refreshPosData();
    else await loadData();
  } catch (error) { message.textContent = error.message; }
}
function updateCustomerMode() {
  const mode = document.querySelector('select[name="customerMode"]').value;
  document.querySelector(".customer-existing").classList.toggle("hidden", mode !== "existing");
  document.querySelector(".customer-new").classList.toggle("hidden", mode !== "new");
}
async function saveBookingRow(event) {
  const row = event.target.closest("tr");
  await api("/api/bookings/" + row.dataset.bookingId, { method:"PATCH", body:JSON.stringify({ bookingDate:row.querySelector('input[name="bookingDate"]').value, bookingTime:row.querySelector('input[name="bookingTime"]').value, staffId:row.querySelector('select[name="staffId"]').value, status:row.querySelector('select[name="status"]').value }) });
  message.textContent = "Booking updated.";
  await refreshPosData();
}
async function saveClosingRow(event) {
  const row = event.target.closest("tr");
  await api("/api/daily-closing/" + row.dataset.closingId, { method:"PATCH", body:JSON.stringify({ actualCash:row.querySelector('input[name="actualCash"]').value, cashTaken:row.querySelector('input[name="cashTaken"]').value, actualCard:row.querySelector('input[name="actualCard"]').value, status:row.querySelector('select[name="status"]').value, approvedBy:row.querySelector('input[name="approvedBy"]').value, notes:row.querySelector('textarea[name="notes"]').value }) });
  message.textContent = "Daily closing updated.";
  await loadData();
}
function renderClosingPreview() {
  const expectedBox = document.querySelector("#closingExpected");
  const varianceBox = document.querySelector("#closingVariance");
  if (!expectedBox || !varianceBox) return;
  const form = document.querySelector("#closingForm");
  const closingDate = form.querySelector('input[name="closingDate"]').value;
  const totals = expectedClosingPreview(closingDate);
  const previousCash = previousClosingCashPreview(closingDate);
  const openingFloat = Math.round(Number(form.querySelector('input[name="openingFloat"]').value || 0) * 100);
  const actualCash = Math.round(Number(form.querySelector('input[name="actualCash"]').value || 0) * 100);
  const cashTaken = Math.round(Number(form.querySelector('input[name="cashTaken"]').value || 0) * 100);
  const remainingCash = Math.max(0, actualCash - cashTaken);
  const actualCard = Math.round(Number(form.querySelector('input[name="actualCard"]').value || 0) * 100);
  form.querySelector('input[name="previousCash"]').value = dollars(previousCash);
  form.querySelector('input[name="remainingCash"]').value = dollars(remainingCash);
  const expectedDrawerCash = previousCash + openingFloat + totals.cashCents;
  expectedBox.innerHTML = '<article><span>Yesterday cash</span><strong>' + money(previousCash) + '</strong></article><article><span>Cash sales today</span><strong>' + money(totals.cashCents) + '</strong></article><article><span>Expected drawer cash</span><strong>' + money(expectedDrawerCash) + '</strong></article><article><span>Expected card sales</span><strong>' + money(totals.cardCents) + '</strong></article><article><span>Transactions</span><strong>' + totals.count + '</strong></article>';
  const cashVariance = actualCash - expectedDrawerCash;
  const cardVariance = actualCard - totals.cardCents;
  varianceBox.innerHTML = '<article><span>Cash taken</span><strong>' + money(cashTaken) + '</strong></article><article><span>Remaining cash</span><strong>' + money(remainingCash) + '</strong></article><article><span>Cash variance</span><strong>' + money(cashVariance) + '</strong></article><article><span>Card variance</span><strong>' + money(cardVariance) + '</strong></article><article><span>Status</span><strong>' + (cashVariance || cardVariance ? "Variance" : "Balanced") + '</strong></article>';
}
function previousClosingCashPreview(date) {
  const branchId = selectedPosBranchId || document.querySelector('#closingForm input[name="branchId"]')?.value || "";
  const previous = (state.dailyClosings || [])
    .filter((closing) => (!branchId || closing.branch_id === branchId) && (!date || String(closing.closing_date || "") < date))
    .sort((a, b) => String(b.closing_date || "").localeCompare(String(a.closing_date || "")))[0];
  return Number(previous?.remaining_cash_cents ?? previous?.actual_cash_cents ?? 0);
}
function expectedClosingPreview(date) {
  return state.sales.filter((sale) => !date || String(sale.created_at || "").slice(0, 10) === date).reduce((totals, sale) => {
    const method = String(sale.payment_method || "");
    const cash = method.match(/cash \$([0-9.]+)/i);
    const card = method.match(/card \$([0-9.]+)/i);
    const change = method.match(/change \$([0-9.]+)/i);
    if (cash) totals.cashCents += Math.max(0, Math.round(Number(cash[1]) * 100) - (change ? Math.round(Number(change[1]) * 100) : 0));
    if (card) totals.cardCents += Math.round(Number(card[1]) * 100);
    if (!cash && !card && method.toLowerCase().includes("cash")) totals.cashCents += Number(sale.total_cents || 0);
    if (!cash && !card && method.toLowerCase().includes("card")) totals.cardCents += Number(sale.total_cents || 0);
    totals.count += 1;
    return totals;
  }, { cashCents:0, cardCents:0, count:0 });
}
function renderCartSummary() {
  const selectedItems = [...document.querySelectorAll(".sale-item")].map((row) => {
    const item = findSaleItem(row.querySelector('input[name="saleItemSearch"]')?.value);
    if (!item) return null;
    return { ...item, name:item.type === "service" ? (row.querySelector('input[name="instanceName"]').value || item.name) : item.name, priceCents:item.type === "service" ? Math.round(Number(row.querySelector('input[name="instancePrice"]').value || 0) * 100) || item.priceCents : item.priceCents };
  }).filter(Boolean);
  document.querySelector("#cartSummary").innerHTML = selectedItems.length ? selectedItems.map((item) => '<div class="cart-line"><span><strong>' + esc(item.name) + '</strong><em>' + esc(item.typeLabel) + '</em></span><b>' + money(item.priceCents) + '</b></div>').join("") : '<p class="hint">Search and add services or products to build the sale.</p>';
  document.querySelector("#cartTotal").textContent = money(selectedItems.reduce((sum, item) => sum + item.priceCents, 0));
}
function updateSaleItemRow(row) {
  const selectedItem = findSaleItem(row.querySelector('input[name="saleItemSearch"]').value);
  const itemKey = selectedItem ? selectedItem.type + ":" + selectedItem.id : "";
  if (itemKey && row.dataset.itemKey !== itemKey) {
    row.querySelector('input[name="instanceName"]').value = selectedItem.name;
    row.querySelector('input[name="instancePrice"]').value = (selectedItem.priceCents / 100).toFixed(2);
  }
  row.dataset.itemKey = itemKey;
  row.querySelector(".line-meta").innerHTML = selectedItem ? '<span class="pill">' + esc(selectedItem.typeLabel) + '</span><strong>' + money(selectedItem.priceCents) + '</strong>' : "";
  row.querySelector(".instance-edit").classList.toggle("hidden", selectedItem?.type !== "service");
  row.querySelector('input[name="instanceName"]').required = selectedItem?.type === "service";
  row.querySelector('input[name="instancePrice"]').required = selectedItem?.type === "service";
  row.querySelector(".staff-area").classList.toggle("hidden", selectedItem?.type === "product");
  if (selectedItem?.type === "product") row.querySelector(".selected-staff").innerHTML = "";
  updateAllocationSummary(row);
  renderCartSummary();
}
function allocationTotals(row) {
  const chips = [...row.querySelectorAll(".staff-chip")];
  return chips.reduce((totals, chip) => { totals.percent += Number(chip.querySelector('input[name="staffPercent"]').value || 0); totals.amount += Number(chip.querySelector('input[name="staffAmount"]').value || 0); return totals; }, { percent:0, amount:0 });
}
function allocationError(row) {
  const item = findSaleItem(row.querySelector('input[name="saleItemSearch"]').value);
  if (!item || item.type !== "service") return "";
  const totals = allocationTotals(row);
  const serviceAmount = Number(row.querySelector('input[name="instancePrice"]').value || 0);
  if (totals.percent > 100) return "Staff percentages for " + (row.querySelector('input[name="instanceName"]').value || item.name) + " cannot exceed 100%.";
  if (totals.amount > serviceAmount) return "Staff dollar allocations cannot exceed the service amount of " + money(Math.round(serviceAmount * 100)) + ".";
  if (totals.amount + (serviceAmount * totals.percent / 100) > serviceAmount + 0.001) return "Combined staff percentage and dollar allocations cannot exceed the service amount.";
  return "";
}
function updateAllocationSummary(row) {
  const totals = allocationTotals(row);
  const summary = row.querySelector(".allocation-summary");
  if (!summary) return;
  const error = allocationError(row);
  summary.textContent = error || ("Staff percentages: " + totals.percent + "% · Staff dollars: $" + totals.amount.toFixed(2));
  summary.classList.toggle("allocation-error", Boolean(error));
}
function staffCheckboxes() { return state.staff.map((s) => '<label class="mini-check"><input type="checkbox" name="saleStaffIds" value="' + s.id + '">' + esc(s.name) + '</label>').join(""); }
function staffSelectOptions(value) { return '<option value="">Unassigned</option>' + state.staff.map((s) => '<option value="' + s.id + '"' + selected(value, s.id) + '>' + esc(s.name) + '</option>').join(""); }
function addStaffToSaleItem(row) {
  const input = row.querySelector('input[name="saleStaffSearch"]');
  const staff = findStaff(input.value);
  if (!staff) { message.textContent = "Select a staff member from the list."; return; }
  if (row.querySelector('input[name="saleStaffIds"][value="' + cssEsc(staff.id) + '"]')) { input.value = ""; return; }
  const chip = document.createElement("label");
  chip.className = "staff-chip";
  chip.innerHTML = '<input type="checkbox" name="saleStaffIds" value="' + esc(staff.id) + '" checked><span>' + esc(staff.name) + '</span><label>%<input name="staffPercent" type="number" min="0" max="100" step="1" placeholder="%"></label><label>$<input name="staffAmount" type="number" min="0" step="0.01" placeholder="$"></label><button type="button" aria-label="Remove staff">x</button>';
  chip.querySelectorAll('input[type="number"]').forEach((field) => field.addEventListener("input", () => updateAllocationSummary(row)));
  chip.querySelector("button").addEventListener("click", () => { chip.remove(); updateAllocationSummary(row); });
  row.querySelector(".selected-staff").append(chip);
  input.value = "";
  updateAllocationSummary(row);
}
function findCustomerId(value) { return state.customers.find((c) => customerLabel(c) === value)?.id || ""; }
function findSaleItem(value) { return saleCatalog().find((item) => item.label === value); }
function findStaff(value) { return state.staff.find((s) => staffLabel(s) === value); }
function customerLabel(c) { return (c.first_name + " " + c.last_name + " | " + c.phone + " | " + c.email).trim(); }
function saleCatalog() {
  return [
    ...state.services.map((s) => ({ type:"service", typeLabel:"Service", id:s.id, name:s.name, priceCents:Number(s.price_cents || 0), label:"Service | " + s.name + " | " + s.category + " | " + money(s.price_cents) })),
    ...(state.products || []).map((p) => ({ type:"product", typeLabel:"Product", id:p.id, name:p.name, priceCents:Number(p.price_cents || 0), label:"Product | " + p.name + " | " + (p.brand || p.category) + " | " + money(p.price_cents) }))
  ];
}
function staffLabel(s) { return s.name + " | " + (s.phone || "No phone") + " | " + (s.email || "No email") + " | " + (s.branch_name || branchName(s.branch_id)); }
function cssEsc(value) { return String(value).replace(/"/g, '\\"'); }
function selected(value, expected) { return value === expected ? " selected" : ""; }
function printLastReceipt() {
  if (!lastReceipt) { message.textContent = "Complete a sale first."; return; }
  const drawerNote = "If your cash drawer is connected to the receipt printer, it should open when this receipt prints.";
  const receipt = window.open("", "kunchasReceipt", "width=380,height=640");
  const paymentRows = (lastReceipt.cashCents ? '<div class="row"><span>Cash paid</span><strong>' + money(lastReceipt.cashCents) + '</strong></div>' : '') + (lastReceipt.cardCents ? '<div class="row"><span>Card paid</span><strong>' + money(lastReceipt.cardCents) + '</strong></div>' : '') + (lastReceipt.changeCents ? '<div class="row total"><span>Change to return</span><span>' + money(lastReceipt.changeCents) + '</span></div>' : '');
  receipt.document.write('<!doctype html><html><head><title>Kunchas receipt</title><style>body{font-family:Arial,sans-serif;margin:18px;color:#111}.center{text-align:center}h1{font-size:20px;margin:0}.line{border-top:1px dashed #999;margin:12px 0}.row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}.total{font-weight:800;font-size:18px}.note{font-size:12px;color:#555}</style></head><body><div class="center"><h1>Kunchas</h1><div>' + esc(lastReceipt.branch?.name || "") + '</div><div>' + esc(lastReceipt.branch?.phone || "") + '</div></div><div class="line"></div><div>Receipt: ' + esc(lastReceipt.saleId) + '</div><div>' + esc(new Date(lastReceipt.createdAt).toLocaleString("en-AU")) + '</div><div class="line"></div>' + lastReceipt.items.map((item) => '<div class="row"><span>' + esc(item.name) + '</span><strong>' + money(item.priceCents) + '</strong></div>').join("") + '<div class="line"></div><div class="row total"><span>Total</span><span>' + money(lastReceipt.totalCents) + '</span></div>' + paymentRows + '<p class="center">Thank you</p><p class="note">' + drawerNote + '</p></body></html>');
  receipt.document.close();
  receipt.focus();
  receipt.print();
}
function branchName(id) { return state.branches.find((branch) => branch.id === id)?.name || "No branch"; }
function money(cents) { return new Intl.NumberFormat("en-AU", { style:"currency", currency:"AUD" }).format(Number(cents || 0) / 100); }
function dollars(cents) { return (Number(cents || 0) / 100).toFixed(2); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c])); }`;
}

function styles() {
  return `
:root { --ink:#1c1724; --muted:#716b79; --line:#e7e1ea; --soft:#f8f6f9; --brand:#5b1b6f; --brand-dark:#3b1048; --brand-soft:#f3eaf6; --gold:#d59b48; --surface:#fff; --success:#087f5b; }
* { box-sizing:border-box; }
body { margin:0; display:grid; grid-template-columns:228px minmax(0,1fr); min-height:100vh; color:var(--ink); background:var(--soft); font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.5; }
.sidebar { position:sticky; top:0; height:100vh; padding:24px 14px; background:linear-gradient(180deg,#471456,#35103f); color:#fff; }
.brand { display:flex; align-items:center; gap:10px; margin-bottom:30px; font-size:22px; }
.brand span { display:grid; place-items:center; width:38px; height:38px; border-radius:11px; background:rgba(255,255,255,.14); font-weight:800; }
nav { display:grid; gap:8px; }
.nav { display:flex; align-items:center; gap:12px; min-height:44px; padding:0 14px; color:#e6dbe9; background:transparent; border:0; border-radius:9px; text-align:left; font:inherit; font-weight:700; cursor:pointer; }
.nav.active,.nav:hover { color:#fff; background:rgba(255,255,255,.12); }
.ui-icon { width:20px; height:20px; flex:0 0 auto; }
.app { min-width:0; padding:24px clamp(18px,3vw,40px) 46px; }
.topbar { display:flex; justify-content:space-between; gap:22px; align-items:center; margin:-24px clamp(-40px,-3vw,-18px) 20px; padding:20px clamp(18px,3vw,40px); background:#fff; border-bottom:1px solid var(--line); }
.eyebrow { margin:0 0 5px; color:var(--brand); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
h1 { margin:0; font-size:clamp(24px,3vw,34px); line-height:1.15; }
h2 { margin:0 0 16px; font-size:24px; }
input,select,textarea { width:100%; min-height:44px; margin:6px 0 14px; padding:0 12px; border:1px solid #ccd7dd; border-radius:8px; font:inherit; background:#fff; }
select[multiple] { min-height:92px; padding:8px 12px; }
textarea { min-height:90px; padding-top:12px; resize:vertical; }
button,.primary,.secondary { min-height:44px; padding:0 18px; border:0; border-radius:8px; font:inherit; font-weight:800; cursor:pointer; }
.primary { color:#fff; background:var(--brand); }
.secondary { color:var(--brand); background:var(--brand-soft); border:1px solid #dfcce5; }
.danger { width:100%; margin-top:12px; color:#9b3444; background:#fff; border:1px solid #d8aeb4; }
.full { width:100%; }
.hidden { display:none; }
.admin-mode .staff-only,.staff-mode .admin-only { display:none !important; }
.hint { margin:8px 0 0; color:var(--muted); font-size:13px; }
.load-row { display:flex; flex-wrap:wrap; align-items:center; gap:14px; }
.admin-mode .load-row { display:none; }
.message { min-height:28px; color:var(--brand); font-weight:800; }
.message:empty { display:none; }
.tab { display:none; margin-top:22px; }
.tab.active { display:block; }
.metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-bottom:18px; }
.metrics article,.panel,.cards article,.branch-grid article { background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 28px rgba(56,24,66,.05); }
.metrics article { padding:18px; }
.metrics span { display:block; color:var(--muted); font-weight:800; }
.metrics strong { display:block; margin-top:8px; font-size:28px; }
.metric-card { display:flex; align-items:center; gap:14px; min-height:88px; }
.metric-icon { display:grid; place-items:center; width:44px; height:44px; flex:0 0 auto; border-radius:50%; }
.metric-icon .ui-icon { width:19px; height:19px; }
.tone-purple { color:#71328a; background:#eadcf5; }.tone-green { color:#168044; background:#e2f3d7; }.tone-orange { color:#d36d13; background:#fff0dc; }.tone-blue { color:#3f6fce; background:#e4edff; }.tone-teal { color:#168487; background:#def2f1; }.tone-pink { color:#d14e7b; background:#fbe2eb; }
.panel { padding:22px; }
.admin-controls,.admin-avatar { display:flex; align-items:center; gap:14px; }
.branch-switcher { min-width:250px; margin:0; }
.branch-switcher span { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; }
.branch-switcher select { margin:2px 0 0; min-height:42px; }
.admin-avatar span { display:grid; place-items:center; width:40px; height:40px; border-radius:50%; color:var(--brand); background:#eadcf0; font-weight:800; }
.dashboard-toolbar,.section-heading { display:flex; justify-content:space-between; align-items:center; gap:18px; }
.dashboard-toolbar { justify-content:flex-end; margin-bottom:14px; }
.dashboard-toolbar h2,.section-heading h2 { margin:0; }
.period-tabs { display:flex; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff; }
.period-tab { min-height:40px; padding:0 16px; color:var(--muted); background:#fff; border:0; border-right:1px solid var(--line); border-radius:0; }
.period-tab:last-child { border-right:0; }
.period-tab.active { color:#fff; background:var(--brand); }
.bookings-chart-panel { margin-bottom:16px; }
.chart-legend { display:flex; align-items:center; gap:7px; color:var(--brand); font-size:12px; font-weight:800; }
.chart-legend span { width:8px; height:8px; border-radius:50%; background:var(--brand); }
.bookings-chart { display:grid; grid-template-columns:repeat(14,minmax(34px,1fr)); align-items:end; min-height:190px; margin-top:18px; padding:12px 8px 0; background:repeating-linear-gradient(to bottom,transparent 0,transparent 44px,#eee8f0 45px); border-bottom:1px solid var(--line); overflow-x:auto; }
.chart-hour { display:grid; grid-template-rows:150px auto; align-items:end; min-width:42px; color:var(--muted); font-size:11px; text-align:center; }
.chart-bar-wrap { position:relative; display:flex; align-items:end; justify-content:center; height:144px; }
.chart-bar-wrap i { display:block; width:10px; min-height:5px; background:linear-gradient(180deg,#7b3294,var(--brand)); border-radius:6px 6px 2px 2px; box-shadow:0 0 0 4px rgba(91,27,111,.08); }
.chart-value { position:absolute; top:4px; color:var(--brand); font-weight:800; }
.chart-hour>span { padding:8px 0; }
.dashboard-lower-grid { display:grid; grid-template-columns:1fr 1.05fr 1.1fr; gap:14px; }
.dashboard-list-panel { min-width:0; }
.dashboard-list-panel h2 { font-size:20px; }
.text-link { color:var(--brand); font-size:12px; font-weight:800; }
.dashboard-roster,.dashboard-upcoming,.dashboard-activity { display:grid; margin-top:12px; }
.dashboard-roster article,.dashboard-upcoming article,.dashboard-activity article { display:flex; align-items:center; gap:11px; min-height:58px; padding:9px 0; border-bottom:1px solid var(--line); }
.dashboard-roster article:last-child,.dashboard-upcoming article:last-child,.dashboard-activity article:last-child { border-bottom:0; }
.dashboard-roster strong,.dashboard-roster span { display:block; }
.dashboard-roster span { color:var(--muted); font-size:12px; }
.dashboard-upcoming time { padding:5px 9px; color:var(--brand); background:var(--brand-soft); border-radius:7px; font-weight:800; }
.dashboard-upcoming div,.dashboard-activity div:nth-child(2) { min-width:0; flex:1; }
.dashboard-upcoming strong,.dashboard-upcoming span,.dashboard-activity strong,.dashboard-activity span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dashboard-upcoming span,.dashboard-activity span { color:var(--muted); font-size:11px; }
.dashboard-upcoming b { width:7px; height:7px; border-radius:50%; background:var(--brand); }
.activity-icon { display:grid; place-items:center; width:34px; height:34px; flex:0 0 auto; color:#fff; background:var(--brand); border-radius:50%; }
.activity-icon .ui-icon { width:17px; height:17px; }
.dashboard-activity time { color:var(--muted); font-size:10px; }
.person-avatar { display:grid; place-items:center; width:36px; height:36px; flex:0 0 auto; color:var(--brand); background:var(--brand-soft); border-radius:50%; font-size:12px; font-weight:800; }
.empty-state { margin:14px 0; color:var(--muted); }
.customer-profile,.staff-profile,.roster-day-panel { margin-top:20px; }
.profile-heading { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; }
.profile-heading h2 { margin-bottom:4px; }
.customer-row,.staff-row { cursor:pointer; }
.customer-row:hover,.customer-row:focus-visible,.staff-row:hover,.staff-row:focus-visible { background:var(--brand-soft); outline:2px solid #d9bee2; outline-offset:-2px; }
.empty-cell { padding:24px; color:var(--muted); text-align:center; }
.split { display:grid; grid-template-columns:minmax(320px,.8fr) minmax(0,1.2fr); gap:20px; align-items:start; }
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
label,legend { display:block; font-weight:800; }
fieldset { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:0 0 14px; padding:0; border:0; }
legend { grid-column:1/-1; }
.check { display:flex; align-items:center; gap:8px; padding:12px; background:#f8fbfc; border:1px solid var(--line); border-radius:8px; }
.check input { width:auto; min-height:auto; margin:0; }
.cards,.branch-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.cards article,.branch-grid article { padding:18px; }
.cards strong,.branch-grid strong { display:block; }
.cards span,.branch-grid span { display:block; color:var(--muted); }
.cards em,.branch-grid em { display:block; margin-top:8px; color:var(--brand); font-style:normal; font-weight:800; }
.service-editor { position:sticky; top:20px; align-self:start; }
.service-category { margin-top:22px; }
.service-category:first-child { margin-top:12px; }
.category-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--line); }
.category-heading h3 { margin:0; font-size:20px; }
.category-heading span { color:var(--muted); font-size:13px; font-weight:800; }
.service-category { padding:10px; margin-left:-10px; margin-right:-10px; border:2px solid transparent; border-radius:10px; transition:.15s ease; }
.service-category.drag-over { background:#fff3ef; border-color:#9b3444; }
.service-card { position:relative; padding-right:54px !important; cursor:grab; user-select:none; }
.service-card:active { cursor:grabbing; }
.service-card.dragging { opacity:.35; }
.edit-service { position:absolute; top:10px; right:10px; width:32px; min-height:32px; padding:0; color:#9b3444; background:#fff; border:1px solid #eadbd6; border-radius:50%; font-size:19px; line-height:1; cursor:pointer; }
.edit-service:hover,.edit-service:focus-visible { color:#fff; background:#9b3444; outline:none; }
.staff-branch-group { padding:10px; margin:12px -10px 0; border:2px solid transparent; border-radius:10px; transition:.15s ease; }
.staff-branch-group.drag-over { background:#fff3ef; border-color:#9b3444; }
.staff-card { position:relative; padding-right:54px !important; cursor:grab; user-select:none; }
.staff-card.dragging { opacity:.35; }
.edit-staff { position:absolute; top:10px; right:10px; width:32px; min-height:32px; padding:0; color:#9b3444; background:#fff; border:1px solid #eadbd6; border-radius:50%; font-size:19px; line-height:1; }
.edit-staff:hover,.edit-staff:focus-visible { color:#fff; background:#9b3444; outline:none; }
.service-inactive { opacity:.62; }
.form-actions { display:flex; gap:10px; }
.form-actions button { flex:1; }
.roster-toolbar { display:flex; align-items:end; justify-content:space-between; gap:20px; }
.roster-toolbar h2 { margin-bottom:2px; }
.roster-toolbar label { min-width:210px; }
.roster-day-panel { padding:0; overflow:hidden; }
.roster-day-panel > .roster-toolbar { align-items:center; padding:22px 24px; border-bottom:1px solid var(--line); }
.roster-toolbar-controls { display:grid; grid-template-columns:minmax(220px,280px) 190px; gap:12px; align-items:end; }
.roster-toolbar-controls label { min-width:0; }
.roster-toolbar-controls select,.roster-toolbar-controls input { margin-bottom:0; background:#fff; }
.roster-calendar-panel { margin-top:20px; }
.month-calendar { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:1px; margin-top:14px; overflow:hidden; background:var(--line); border:1px solid var(--line); border-radius:12px; }
.month-weekday { padding:7px; color:var(--muted); font-size:12px; font-weight:800; text-align:center; text-transform:uppercase; }
.month-blank { min-height:100px; background:#faf9fa; }
.month-day { min-height:108px; padding:11px; color:var(--ink); background:#fff; border:0; border-radius:0; text-align:left; }
.month-day strong,.month-day span { display:block; }
.month-day strong { font-size:18px; }
.month-day span { margin-top:5px; color:var(--muted); font-size:11px; }
.month-day:hover,.month-day:focus-visible,.month-day.selected { background:var(--brand-soft); box-shadow:inset 0 0 0 2px var(--brand); outline:none; }
.roster-branch-board { display:grid; grid-template-columns:1fr; margin:0; }
.roster-branch-card { padding:0; border:0; border-radius:0; background:#fff; }
.roster-branch-card h3 { margin:0; }
.roster-table-head { display:grid; grid-template-columns:minmax(200px,1fr) 135px 135px 128px; gap:12px; padding:9px 24px; color:var(--muted); background:#fff; border-bottom:1px solid var(--line); font-size:11px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
.roster-assigned { display:grid; gap:0; min-height:0; margin:0; }
.roster-person { display:grid; grid-template-columns:minmax(200px,1fr) 135px 135px 128px; align-items:center; gap:12px; width:100%; padding:12px 24px; color:var(--ink); background:#fff; border:0; border-bottom:1px solid var(--line); border-radius:0; }
.roster-person:hover { background:#fdfbfd; }
.roster-person strong,.roster-person span { display:block; }
.roster-person span { color:var(--muted); font-size:11px; }
.roster-person-name { display:flex; align-items:center; gap:10px; min-width:0; }
.roster-person-name .person-avatar { display:grid; place-items:center; width:38px; height:38px; flex:0 0 auto; color:var(--brand); background:var(--brand-soft); border-radius:10px; font-size:12px; font-weight:900; }
.roster-person-name div { min-width:0; }
.roster-person label,.branch-assign-row label { font-size:11px; color:var(--muted); }
.roster-person input,.branch-assign-row input,.branch-assign-row select { min-height:38px; margin:2px 0 0; }
.roster-row-actions { display:flex; align-items:center; gap:6px; }
.roster-row-actions button { min-height:38px; white-space:nowrap; }
.icon-danger { width:38px; padding:0; color:#a6293d; background:#fff0f2; border:1px solid #efc8ce; }
.branch-assign-row { display:grid; grid-template-columns:minmax(200px,1fr) 135px 135px 128px; gap:12px; margin:0; padding:16px 24px 20px; border-top:0; background:#f8f4fa; align-items:end; }
.branch-assign-row button { width:100%; }
.roster-empty { margin:0; padding:24px; color:var(--muted); border-bottom:1px solid var(--line); text-align:center; }
.day-off-card { background:#fff0f1; border-color:#e5b1b8; }
.day-off-card .roster-person { margin-bottom:8px; background:#fff; border-color:#e5b1b8; }
.day-off-fieldset { display:block; margin:12px 0 16px; }
.day-off-fieldset legend { margin-bottom:2px; }
.day-checks { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0; }
.day-chip { position:relative; cursor:pointer; }
.day-chip input { position:absolute; opacity:0; pointer-events:none; }
.day-chip span { display:grid; place-items:center; min-width:44px; min-height:38px; padding:0 9px; color:var(--muted); background:#fff; border:1px solid var(--line); border-radius:9px; }
.day-chip input:checked + span { color:#fff; background:var(--brand); border-color:var(--brand); }
.branch-roster-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:18px 24px; background:#faf8fb; border-bottom:1px solid var(--line); }
.branch-roster-heading h3 { margin:0; }
.branch-roster-heading span { color:var(--muted); font-size:12px; }
.branch-roster-heading strong { color:var(--brand); font-size:13px; }
.roster-day-stats { display:flex; align-items:center; justify-content:flex-end; gap:8px; }
.roster-day-stats span,.roster-day-stats strong { padding:5px 9px; border-radius:999px; }
.roster-day-stats span { background:#eee8f0; }
.roster-day-stats strong { background:var(--brand-soft); }
.branch-pos { display:inline-flex; margin-top:12px; color:var(--brand); font-weight:800; }
.branch-detail-heading { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:12px; margin:16px 0 22px; padding:16px; background:var(--brand-soft); border:1px solid #e3d3e8; border-radius:12px; }
.branch-detail-heading strong { font-size:20px; }
.branch-detail-heading span { color:var(--muted); }
.branch-icon { display:grid; place-items:center; width:42px; height:42px; flex:0 0 auto; color:#fff; background:var(--brand); border-radius:11px; font-weight:800; }
.branch-card-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.timetable-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:20px; }
.timetable-list div { display:flex; justify-content:space-between; gap:12px; padding:10px 12px; background:#faf8fb; border:1px solid var(--line); border-radius:9px; }
.timetable-list span { color:var(--muted); }
.closure-list { display:flex; flex-wrap:wrap; gap:8px; }
.closure-chip,.pin-code { display:inline-flex; padding:7px 10px; color:var(--brand); background:var(--brand-soft); border:1px solid #e3d3e8; border-radius:8px; font-weight:800; }
.page-heading { margin-bottom:14px; }
.sale-item { padding:14px; margin-bottom:12px; background:#f8fbfc; border:1px solid var(--line); border-radius:8px; }
.line-meta { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:34px; margin:-4px 0 10px; }
.line-meta strong { font-size:18px; }
.cart-panel { position:sticky; top:20px; }
.cart-summary { display:grid; gap:10px; min-height:120px; }
.cart-line { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; background:#f8fbfc; border:1px solid var(--line); border-radius:8px; }
.cart-line strong,.cart-line em { display:block; }
.cart-line em { color:var(--muted); font-style:normal; font-size:13px; }
.cart-total { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:16px; padding-top:16px; border-top:1px solid var(--line); }
.cart-total span { color:var(--muted); font-weight:800; }
.cart-total strong { font-size:30px; }
.closing-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:10px 0 14px; }
.closing-summary article { padding:12px; background:#f8fbfc; border:1px solid var(--line); border-radius:8px; }
.closing-summary span { display:block; color:var(--muted); font-size:12px; font-weight:800; }
.closing-summary strong { display:block; margin-top:4px; font-size:20px; }
.field-label { display:block; margin-bottom:8px; font-weight:800; }
.staff-checks { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.mini-check { display:flex; align-items:center; gap:8px; min-height:44px; padding:10px; margin:0; background:#fff; border:1px solid var(--line); border-radius:8px; font-weight:700; }
.mini-check input { width:auto; min-height:auto; margin:0; }
.staff-add-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:start; }
.staff-add-row input { margin-top:0; }
.booking-service-picker { margin-bottom:14px; }
.selected-booking-services { display:grid; gap:8px; margin:8px 0; }
.booking-service-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:12px; padding:11px 12px; background:#f8fbfc; border:1px solid var(--line); border-radius:8px; }
.booking-service-row strong,.booking-service-row em { display:block; }
.booking-service-row em { color:var(--muted); font-size:12px; font-style:normal; }
.booking-service-row button { width:32px; min-height:32px; padding:0; color:#9b3444; background:#fff3ef; }
.booking-service-total { display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-top:1px solid var(--line); font-weight:800; }
.booking-service-total strong { font-size:22px; }
.selected-staff { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }
.staff-chip { display:inline-flex; align-items:center; flex-wrap:wrap; gap:8px; min-height:40px; padding:8px 8px 8px 10px; margin:0; color:#9b3444; background:#fff3ef; border:1px solid #eadbd6; border-radius:8px; font-weight:800; }
.staff-chip input { position:absolute; opacity:0; pointer-events:none; width:1px; min-height:1px; margin:0; }
.staff-chip label { display:inline-flex; align-items:center; gap:4px; font-size:12px; }
.staff-chip label input { position:static; opacity:1; pointer-events:auto; width:72px; min-height:30px; margin:0; padding:0 8px; }
.staff-chip button { min-height:26px; width:26px; padding:0; color:#9b3444; background:#fff; border:1px solid #eadbd6; border-radius:6px; }
.allocation-error { color:#b42318 !important; font-weight:800; }
.table-wrap { overflow-x:auto; }
table { width:100%; min-width:760px; border-collapse:collapse; }
th,td { padding:12px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
th { color:var(--muted); font-size:12px; text-transform:uppercase; }
.pill { display:inline-flex; padding:4px 9px; color:#9b3444; background:#fff3ef; border:1px solid #eadbd6; border-radius:8px; font-weight:800; }
.checkout-booking { display:block; margin-top:8px; white-space:nowrap; }
@media (max-width:1100px){ .dashboard-lower-grid{grid-template-columns:1fr}.roster-table-head{display:none}.roster-person,.branch-assign-row{grid-template-columns:minmax(180px,1fr) 120px 120px}.roster-row-actions,.branch-assign-row button{grid-column:1/-1}.roster-row-actions{justify-content:flex-end}.branch-assign-row button{justify-self:end;width:auto} }
@media (max-width:1000px){ body{grid-template-columns:1fr}.sidebar{position:static;height:auto}.topbar,.split{grid-template-columns:1fr;display:grid}.metrics,.cards,.branch-grid{grid-template-columns:repeat(2,minmax(0,1fr))} }
@media (max-width:700px){ .topbar,.dashboard-toolbar,.admin-controls,.roster-toolbar{align-items:stretch;flex-direction:column}.roster-toolbar-controls{grid-template-columns:1fr}.period-tabs{display:grid;grid-template-columns:repeat(2,1fr)}.branch-switcher{min-width:0}.metrics,.cards,.branch-grid,.grid,fieldset,.staff-checks,.closing-summary,.roster-person,.branch-assign-row,.timetable-list{grid-template-columns:1fr}.branch-roster-heading{align-items:flex-start;flex-direction:column}.roster-day-stats{justify-content:flex-start}.roster-person,.branch-assign-row{padding-left:18px;padding-right:18px}.roster-row-actions{justify-content:flex-start}.branch-assign-row button{justify-self:stretch;width:100%}.month-day{min-height:76px}.month-day span{display:none} }
`;
}
