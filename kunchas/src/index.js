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
        ctx.waitUntil(logEvent("sale_created"));
        return response;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-closing") {
        const auth = await authorizeBranch(request, env);
        if (auth) return auth;
        return createDailyClosing(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        const auth = authorizeAdmin(request, env);
        if (auth) return auth;
      }

      if (request.method === "GET" && url.pathname === "/api/app-data") return getAppData(env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/daily-closing/")) return updateDailyClosing(request, env, clean(url.pathname.replace("/api/daily-closing/", "")));
      if (request.method === "POST" && url.pathname === "/api/customers") return createCustomer(request, env);
      if (request.method === "POST" && url.pathname === "/api/bookings") return createBooking(request, env);
      if (request.method === "POST" && url.pathname === "/api/services") return createService(request, env);
      if (request.method === "POST" && url.pathname === "/api/products") return createProduct(request, env);
      if (request.method === "POST" && url.pathname === "/api/staff") return createStaff(request, env);
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
  const [branches, staff, services, products, customers, bookings, sales, branchHours, closedDates, discounts, inventoryStock, stockMovements, dailyClosings] = await Promise.all([
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
      ORDER BY dc.closing_date DESC, br.name LIMIT 200`)
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
    branchHours,
    closedDates,
    discounts,
    inventoryStock,
    stockMovements,
    dailyClosings
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

  const admin = authorizeAdminOptional(request, env);
  if (admin) {
    const branchId = clean(request.headers.get("x-branch-id"));
    const branchPin = clean(request.headers.get("x-branch-pin"));
    if (!branchId || branchId !== existing.branch_id || !branchPin) {
      return jsonResponse({ error: "Staff can only edit bookings for the open branch." }, 401);
    }
    const rows = await all(env, "SELECT post_code FROM branches WHERE id = ? AND status = 'Open'", [branchId]);
    if (!rows[0]?.post_code || rows[0].post_code !== branchPin) {
      return jsonResponse({ error: "Incorrect branch PIN." }, 401);
    }
  }

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
  const branchId = clean(body.branchId);
  const name = clean(body.name);
  if (!branchId || !name) return jsonResponse({ error: "Branch and staff name are required." }, 400);
  await env.DB.prepare("INSERT INTO staff (id, branch_id, name, role, email, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(`staff-${crypto.randomUUID()}`, branchId, name, clean(body.role) || "Stylist", clean(body.email), clean(body.phone), clean(body.status) || "Active")
    .run();
  return jsonResponse({ ok: true });
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
  const customerId = clean(body.customerId) || await ensureSaleCustomer(env, body, branchId);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!branchId || !items.length) {
    return jsonResponse({ error: "Branch and sale items are required." }, 400);
  }

  const serviceIds = items.filter((item) => clean(item.itemType || "service") === "service").map((item) => clean(item.itemId || item.serviceId)).filter(Boolean);
  const productIds = items.filter((item) => clean(item.itemType) === "product").map((item) => clean(item.itemId)).filter(Boolean);
  if (!serviceIds.length && !productIds.length) {
    return jsonResponse({ error: "Select at least one service or product." }, 400);
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
      return {
        itemType: isProduct ? "product" : "service",
        serviceId: isProduct ? null : record.id,
        productId: isProduct ? record.id : null,
        name: record.name,
        priceCents: Number(record.price_cents || 0),
        staffIds: isProduct ? [] : (Array.isArray(item.staffIds) ? item.staffIds.map(clean).filter(Boolean) : []),
        staffAllocations: isProduct ? [] : normalizeStaffAllocations(item.staffAllocations)
      };
    })
    .filter(Boolean);
  if (!saleItems.length) {
    return jsonResponse({ error: "Select valid services or products for the sale." }, 400);
  }
  const totalCents = saleItems.reduce((total, item) => total + item.priceCents, 0);
  const cashCents = Math.round(Number(body.cashAmount || 0) * 100);
  const cardCents = Math.round(Number(body.cardAmount || 0) * 100);
  if (cashCents + cardCents < totalCents) {
    return jsonResponse({ error: "Payment total must cover the sale amount." }, 400);
  }
  const paymentMethod = paymentLabel(cashCents, cardCents, totalCents, clean(body.paymentMethod));
  const changeCents = Math.max(0, cashCents + cardCents - totalCents);

  await env.DB.prepare(
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
    )
    .run();

  await env.DB.batch(
    saleItems.map((item) =>
      env.DB.prepare(
        "INSERT INTO sale_items (id, sale_id, item_name, quantity, price_cents, service_id, staff_ids, staff_allocations) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), id, item.name, 1, item.priceCents, item.serviceId, JSON.stringify(item.staffIds), JSON.stringify(item.staffAllocations))
    )
  );

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
  return jsonResponse({ ok: true, saleId: id, totalCents, receipt: { saleId: id, createdAt: now, branch, items: saleItems, totalCents, cashCents, cardCents, changeCents, paymentMethod } });
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

function authorizeAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: "Admin access is not configured. Set ADMIN_TOKEN first." }, 503);
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  return token === env.ADMIN_TOKEN ? null : jsonResponse({ error: "Unauthorized" }, 401);
}

async function authorizeBranch(request, env) {
  const admin = authorizeAdminOptional(request, env);
  if (!admin) return null;

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
  const admin = authorizeAdminOptional(request, env);
  if (!admin) return null;

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
  const admin = authorizeAdminOptional(request, env);
  if (!admin) return null;

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

function authorizeAdminOptional(request, env) {
  if (!env.ADMIN_TOKEN) return jsonResponse({ error: "Admin access is not configured. Set ADMIN_TOKEN first." }, 503);
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  return token === env.ADMIN_TOKEN ? null : jsonResponse({ error: "Unauthorized" }, 401);
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
      <button class="nav ${initialTab === "overview" ? "active" : ""}" data-tab="overview">Dashboard</button>
      <button class="nav" data-tab="customers">Customers</button>
      <button class="nav" data-tab="staff">Staff</button>
      <button class="nav" data-tab="services">Services</button>
      <button class="nav" data-tab="products">Products</button>
      <button class="nav" data-tab="inventory">Inventory</button>
      <button class="nav" data-tab="reports">Reports</button>
      <button class="nav" data-tab="branches">Timetable</button>
      <button class="nav" data-tab="discounts">Discounts</button>` : `
      <button class="nav ${initialTab === "pos" ? "active" : ""}" data-tab="pos">POS</button>
      <button class="nav ${initialTab === "bookings" ? "active" : ""}" data-tab="bookings">Bookings</button>
      <button class="nav" data-tab="closing">Daily Closing</button>`}
      ${isAdmin ? "" : `<button class="nav" data-tab="recent-sales">Recent Sales</button>`}
    </nav>
  </aside>

  <main class="app">
    <header class="topbar">
      <div>
        <p class="eyebrow">Cloud software for SMBs</p>
        <h1>${isAdmin ? "Kunchas admin dashboard" : "Kunchas staff workspace"}</h1>
      </div>
      <label class="token admin-only">Admin token <input id="token" type="password" placeholder="Required"></label>
    </header>

    <div class="load-row admin-only">
      <button class="primary" id="loadData" type="button">Load data</button>
    </div>
    <p class="message" id="message">${isAdmin ? "Enter the admin token, then load data." : "Open your branch with the postcode PIN."}</p>

    <section class="tab admin-only ${initialTab === "overview" ? "active" : ""}" id="overview">
      <div class="metrics" id="metrics"></div>
      <div class="panel">
        <h2>Branch summary</h2>
        <div class="branch-grid" id="branchSummary"></div>
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
          <fieldset id="bookingServices"><legend>Services</legend></fieldset>
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
        <div class="panel"><h2>Customers</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Tags</th></tr></thead><tbody id="customersTable"></tbody></table></div></div>
      </div>
    </section>

    <section class="tab admin-only" id="staff">
      <div class="split">
        <form class="panel" id="staffForm"><h2>Add staff</h2><label>Branch<select name="branchId" required></select></label><div class="grid"><label>Name<input name="name" required></label><label>Role<input name="role" placeholder="Senior stylist"></label></div><div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div><button class="primary full" type="submit">Save staff</button></form>
        <div class="panel"><h2>Staff</h2><div class="cards" id="staffCards"></div></div>
      </div>
    </section>
    <section class="tab admin-only" id="services">
      <div class="split">
        <form class="panel" id="serviceForm"><h2>Add service</h2><div class="grid"><label>Name<input name="name" required></label><label>Category<input name="category" placeholder="Hair"></label></div><div class="grid"><label>Duration minutes<input name="durationMinutes" type="number" min="1" required></label><label>Price $<input name="price" type="number" min="0" step="0.01" required></label></div><button class="primary full" type="submit">Save service</button></form>
        <div class="panel"><h2>Shared services</h2><div class="cards" id="serviceCards"></div></div>
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
        <div class="panel"><h2>Stock on hand</h2><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Product</th><th>SKU</th><th>Qty</th><th>Status</th></tr></thead><tbody id="inventoryTable"></tbody></table></div></div>
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
      <div class="panel"><h2>Admin closing review</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Actual cash</th><th>Cash taken</th><th>Actual card</th><th>Status</th><th>Approved by</th><th></th></tr></thead><tbody id="adminClosingTable"></tbody></table></div></div>
    </section>
    <section class="tab admin-only" id="branches">
      <div class="split">
        <form class="panel" id="hoursForm"><h2>Branch timetable</h2><label>Branch<select name="branchId" required></select></label><label>Day<select name="dayOfWeek"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option></select></label><div class="grid"><label>Open<input name="openTime" type="time" value="09:00"></label><label>Close<input name="closeTime" type="time" value="17:30"></label></div><label class="check"><input name="isClosed" type="checkbox">Closed every week on this day</label><button class="primary full" type="submit">Save timetable</button></form>
        <form class="panel" id="closedDateForm"><h2>Closed date</h2><label>Branch<select name="branchId" required></select></label><label>Date<input name="closedDate" type="date" required></label><label>Reason<input name="reason" placeholder="Public holiday"></label><button class="primary full" type="submit">Add closed date</button></form>
      </div>
      <div class="panel"><h2>5 branches</h2><div class="cards" id="branchCards"></div></div>
    </section>
    <section class="tab admin-only" id="discounts">
      <div class="split">
        <form class="panel" id="discountForm"><h2>Add discount</h2><label>Name<input name="name" required></label><div class="grid"><label>Type<select name="type"><option>Percent</option><option>Amount</option></select></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required></label></div><div class="grid"><label>Starts<input name="startsAt" type="date"></label><label>Ends<input name="endsAt" type="date"></label></div><button class="primary full" type="submit">Save discount</button></form>
        <div class="panel"><h2>Discounts</h2><div class="cards" id="discountCards"></div></div>
      </div>
    </section>
  </main>
  <script>window.initialBranchId = ${JSON.stringify(initialBranchId)}; window.appMode = ${JSON.stringify(mode)}; ${clientScript()}</script>
</body>
</html>`;
}

function clientScript() {
  return `
let state = { branches: [], staff: [], services: [], products: [], customers: [], bookings: [], sales: [], branchHours: [], closedDates: [], discounts: [], inventoryStock: [], stockMovements: [], dailyClosings: [] };
let lastReceipt = null;
let selectedPosBranchId = "";
let selectedPosPin = "";
const appMode = window.appMode || "admin";
const token = document.querySelector("#token");
const message = document.querySelector("#message");
document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".nav,.tab").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  document.querySelector("#" + button.dataset.tab).classList.add("active");
}));
document.querySelector("#loadData").addEventListener("click", loadData);
document.querySelector("#openPos").addEventListener("click", openPos);
document.querySelector("#switchBranch").addEventListener("click", switchBranch);
document.querySelector("#addSaleItem").addEventListener("click", () => addSaleItem());
document.querySelector("#printReceipt").addEventListener("click", printLastReceipt);
document.querySelector("#customerForm").addEventListener("submit", submitCustomer);
document.querySelector("#bookingForm").addEventListener("submit", submitBooking);
document.querySelector("#saleForm").addEventListener("submit", submitSale);
document.querySelector('select[name="customerMode"]').addEventListener("change", updateCustomerMode);
document.querySelector('#closingForm input[name="closingDate"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="openingFloat"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="actualCash"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="cashTaken"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="actualCard"]').addEventListener("input", renderClosingPreview);
document.querySelector("#staffForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/staff"));
document.querySelector("#serviceForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/services"));
document.querySelector("#productForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/products"));
document.querySelector("#stockForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/stock-movements"));
document.querySelector("#closingForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/daily-closing"));
document.querySelector("#hoursForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/branch-hours"));
document.querySelector("#closedDateForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/closed-dates"));
document.querySelector("#discountForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/discounts"));
addSaleItem();
updateCustomerMode();
loadPublicBranches();

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}), authorization: "Bearer " + token.value };
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
    state = await api("/api/app-data");
    renderAll();
    message.textContent = "Cloud software loaded.";
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
  state = { branches: [], staff: [], services: [], products: [], customers: [], bookings: [], sales: [], branchHours: [], closedDates: [], discounts: [], inventoryStock: [], stockMovements: [], dailyClosings: [] };
  document.querySelector("#posWorkspace").classList.add("hidden");
  document.querySelector("#posLogin").classList.remove("hidden");
  document.querySelector("#posPin").value = "";
}
async function refreshPosData() {
  try {
    message.textContent = "Opening branch workspace...";
    state = await api("/api/pos-data");
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
function renderAll() { fillSelects(); renderMetrics(); renderBranches(); renderStaff(); renderServices(); renderProducts(); renderCustomers(); renderBookings(); renderSales(); renderDiscounts(); renderInventory(); renderClosings(); renderReports(); renderClosingPreview(); }
function fillSelects() {
  const branchOptions = state.branches.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join("");
  const staffSelectOptions = '<option value="">Unassigned</option>' + state.staff.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join("");
  const customerOptions = '<option value="">Walk-in</option>' + state.customers.map((c) => '<option value="' + c.id + '">' + esc(c.first_name + " " + c.last_name) + '</option>').join("");
  const productOptions = '<option value="">Select product</option>' + (state.products || []).map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' - ' + money(p.price_cents) + '</option>').join("");
  document.querySelectorAll('select[name="branchId"]').forEach((select) => select.innerHTML = branchOptions);
  if (window.initialBranchId) {
    document.querySelectorAll('select[name="branchId"]').forEach((select) => select.value = window.initialBranchId);
  }
  document.querySelectorAll('select[name="staffId"]').forEach((select) => select.innerHTML = staffSelectOptions);
  document.querySelectorAll('select[name="customerId"]').forEach((select) => select.innerHTML = customerOptions);
  document.querySelectorAll('select[name="productId"]').forEach((select) => select.innerHTML = productOptions);
  document.querySelector("#customerList").innerHTML = state.customers.map((c) => '<option value="' + esc(customerLabel(c)) + '"></option>').join("");
  document.querySelector("#itemList").innerHTML = saleCatalog().map((item) => '<option value="' + esc(item.label) + '"></option>').join("");
  document.querySelector("#staffList").innerHTML = state.staff.map((s) => '<option value="' + esc(staffLabel(s)) + '"></option>').join("");
  document.querySelector("#bookingServices").innerHTML = "<legend>Services</legend>" + state.services.map((service) =>
    '<label class="check"><input type="checkbox" name="serviceIds" value="' + service.id + '">' + esc(service.name) + ' - ' + money(service.price_cents) + '</label>'
  ).join("");
  document.querySelectorAll(".staff-checks").forEach((box) => box.innerHTML = staffCheckboxes());
  renderCartSummary();
}
function renderMetrics() {
  const revenue = state.sales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
  document.querySelector("#metrics").innerHTML = [["Branches", state.branches.length], ["Staff", state.staff.length], ["Customers", state.customers.length], ["Bookings", state.bookings.length], ["Revenue", money(revenue)]].map(([label, value]) => '<article><span>' + label + '</span><strong>' + value + '</strong></article>').join("");
  document.querySelector("#branchSummary").innerHTML = state.branches.map((branch) => {
    const branchSales = state.sales.filter((sale) => sale.branch_id === branch.id);
    const branchRevenue = branchSales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
    return '<article><strong>' + esc(branch.name) + '</strong><span>' + branchSales.length + ' sales</span><em>' + money(branchRevenue) + '</em></article>';
  }).join("");
}
function renderBranches() { document.querySelector("#branchCards").innerHTML = state.branches.map((b) => '<article><strong>' + esc(b.name) + '</strong><span>' + esc(b.address) + '</span><em>' + esc(b.phone) + '</em><a class="branch-pos" href="/pos/' + esc(b.id) + '">Open branch POS</a></article>').join(""); }
function renderStaff() { document.querySelector("#staffCards").innerHTML = state.staff.map((s) => '<article><strong>' + esc(s.name) + '</strong><span>' + esc(s.role) + '</span><em>' + esc(branchName(s.branch_id)) + '</em></article>').join(""); }
function renderServices() { document.querySelector("#serviceCards").innerHTML = state.services.map((s) => '<article><strong>' + esc(s.name) + '</strong><span>' + esc(s.category) + ' - ' + s.duration_minutes + ' min</span><em>' + money(s.price_cents) + '</em></article>').join(""); }
function renderProducts() { document.querySelector("#productCards").innerHTML = (state.products || []).map((p) => '<article><strong>' + esc(p.name) + '</strong><span>' + esc(p.category) + ' - SKU ' + esc(p.sku || "") + '</span><em>' + money(p.price_cents) + '</em></article>').join(""); }
function renderCustomers() { document.querySelector("#customersTable").innerHTML = state.customers.map((c) => '<tr><td><strong>' + esc(c.first_name + " " + c.last_name) + '</strong></td><td>' + esc(c.email) + '</td><td>' + esc(c.phone) + '</td><td>' + esc(c.tags || "") + '</td></tr>').join(""); }
function renderBookings() {
  document.querySelector("#bookingsTable").innerHTML = state.bookings.map((b) =>
    '<tr data-booking-id="' + esc(b.id) + '"><td><input name="bookingDate" type="date" value="' + esc(b.booking_date) + '"><input name="bookingTime" type="time" value="' + esc(b.booking_time) + '"></td><td><strong>' + esc(b.customer_name) + '</strong><div class="hint">' + esc(b.notes || "") + '</div></td><td><select name="staffId">' + staffSelectOptions(b.staff_id) + '</select></td><td>' + esc(b.service_names) + '</td><td><select name="status"><option' + selected(b.status, "Booked") + '>Booked</option><option' + selected(b.status, "Confirmed") + '>Confirmed</option><option' + selected(b.status, "Completed") + '>Completed</option><option' + selected(b.status, "Cancelled") + '>Cancelled</option><option' + selected(b.status, "No show") + '>No show</option></select></td><td><button class="secondary save-booking" type="button">Save</button></td></tr>'
  ).join("");
  document.querySelectorAll(".save-booking").forEach((button) => button.addEventListener("click", saveBookingRow));
}
function renderSales() { document.querySelector("#salesTable").innerHTML = state.sales.map((s) => '<tr><td>' + esc(s.branch_name) + '</td><td>' + money(s.total_cents) + '</td><td>' + esc(s.payment_method) + '</td><td><span class="pill">' + esc(s.status) + '</span></td></tr>').join(""); }
function renderDiscounts() { document.querySelector("#discountCards").innerHTML = (state.discounts || []).map((d) => '<article><strong>' + esc(d.name) + '</strong><span>' + esc(d.type) + ' ' + esc(d.amount) + '</span><em>' + esc(d.status) + '</em></article>').join(""); }
function renderInventory() {
  document.querySelector("#inventoryTable").innerHTML = (state.inventoryStock || []).map((item) => '<tr><td>' + esc(item.branch_name) + '</td><td>' + esc(item.product_name) + '</td><td>' + esc(item.sku || "") + '</td><td>' + esc(item.quantity) + '</td><td><span class="pill">' + esc(Number(item.quantity) <= Number(item.low_stock_level) ? "Low stock" : "OK") + '</span></td></tr>').join("");
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
}
function addSaleItem() {
  const row = document.createElement("div");
  row.className = "sale-item";
  row.innerHTML = '<label>Service / product search<input name="saleItemSearch" list="itemList" required placeholder="Type service or product"></label><div class="line-meta"></div><div class="staff-area"><span class="field-label">Staff involved</span><div class="staff-add-row"><input name="saleStaffSearch" list="staffList" placeholder="Type staff name, phone, or email"><button class="secondary add-staff" type="button">Add</button></div><div class="selected-staff"></div><p class="hint">Add all staff who worked on this service. Staff can be from any branch.</p></div>';
  document.querySelector("#saleItems").append(row);
  row.querySelector(".add-staff").addEventListener("click", () => addStaffToSaleItem(row));
  row.querySelector('input[name="saleItemSearch"]').addEventListener("input", () => updateSaleItemRow(row));
  updateSaleItemRow(row);
}
async function submitCustomer(event) { event.preventDefault(); await submitJson("/api/customers", Object.fromEntries(new FormData(event.target)), event.target); }
async function submitBooking(event) {
  event.preventDefault();
  const data = new FormData(event.target);
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
      staffIds: selectedItem.type === "service" ? [...row.querySelectorAll('input[name="saleStaffIds"]:checked')].map((input) => input.value) : [],
      staffAllocations: selectedItem.type === "service" ? [...row.querySelectorAll(".staff-chip")].map((chip) => ({
        staffId: chip.querySelector('input[name="saleStaffIds"]').value,
        percent: chip.querySelector('input[name="staffPercent"]').value,
        amount: chip.querySelector('input[name="staffAmount"]').value
      })) : []
    };
  }).filter(Boolean);
  await submitJson("/api/sales", {
    branchId:data.get("branchId"),
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
    if (form.id === "saleForm") { document.querySelector("#saleItems").innerHTML = ""; addSaleItem(); updateCustomerMode(); }
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
  const selectedItems = [...document.querySelectorAll(".sale-item")].map((row) => findSaleItem(row.querySelector('input[name="saleItemSearch"]')?.value)).filter(Boolean);
  document.querySelector("#cartSummary").innerHTML = selectedItems.length ? selectedItems.map((item) => '<div class="cart-line"><span><strong>' + esc(item.name) + '</strong><em>' + esc(item.typeLabel) + '</em></span><b>' + money(item.priceCents) + '</b></div>').join("") : '<p class="hint">Search and add services or products to build the sale.</p>';
  document.querySelector("#cartTotal").textContent = money(selectedItems.reduce((sum, item) => sum + item.priceCents, 0));
}
function updateSaleItemRow(row) {
  const selectedItem = findSaleItem(row.querySelector('input[name="saleItemSearch"]').value);
  row.querySelector(".line-meta").innerHTML = selectedItem ? '<span class="pill">' + esc(selectedItem.typeLabel) + '</span><strong>' + money(selectedItem.priceCents) + '</strong>' : "";
  row.querySelector(".staff-area").classList.toggle("hidden", selectedItem?.type === "product");
  if (selectedItem?.type === "product") row.querySelector(".selected-staff").innerHTML = "";
  renderCartSummary();
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
  chip.querySelector("button").addEventListener("click", () => chip.remove());
  row.querySelector(".selected-staff").append(chip);
  input.value = "";
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
:root { --ink:#18212f; --muted:#617083; --line:#dfe7eb; --soft:#f4f8fa; --brand:#b84e5c; --gold:#d59b48; --surface:#fff; }
* { box-sizing:border-box; }
body { margin:0; display:grid; grid-template-columns:260px minmax(0,1fr); min-height:100vh; color:var(--ink); background:var(--soft); font-family:Arial,sans-serif; line-height:1.5; }
.sidebar { position:sticky; top:0; height:100vh; padding:24px 18px; background:#17202d; color:#fff; }
.brand { display:flex; align-items:center; gap:10px; margin-bottom:30px; font-size:22px; }
.brand span { display:grid; place-items:center; width:38px; height:38px; border-radius:8px; background:linear-gradient(135deg,var(--brand),var(--gold)); font-weight:800; }
nav { display:grid; gap:8px; }
.nav { min-height:42px; padding:0 14px; color:#cbd6df; background:transparent; border:0; border-radius:8px; text-align:left; font:inherit; font-weight:800; cursor:pointer; }
.nav.active,.nav:hover { color:#fff; background:rgba(255,255,255,.12); }
.app { min-width:0; padding:28px clamp(18px,4vw,46px) 46px; }
.topbar { display:flex; justify-content:space-between; gap:22px; align-items:flex-start; margin-bottom:18px; }
.eyebrow { margin:0 0 8px; color:#9b3444; font-size:12px; font-weight:800; text-transform:uppercase; }
h1 { margin:0; font-size:clamp(32px,4vw,58px); line-height:1; }
h2 { margin:0 0 16px; font-size:24px; }
.token { min-width:260px; font-weight:800; }
input,select,textarea { width:100%; min-height:44px; margin:6px 0 14px; padding:0 12px; border:1px solid #ccd7dd; border-radius:8px; font:inherit; background:#fff; }
select[multiple] { min-height:92px; padding:8px 12px; }
textarea { min-height:90px; padding-top:12px; resize:vertical; }
button,.primary,.secondary { min-height:44px; padding:0 18px; border:0; border-radius:8px; font:inherit; font-weight:800; cursor:pointer; }
.primary { color:#fff; background:var(--brand); }
.secondary { color:#9b3444; background:#fff3ef; border:1px solid #eadbd6; }
.full { width:100%; }
.hidden { display:none; }
.admin-mode .staff-only,.staff-mode .admin-only { display:none !important; }
.hint { margin:8px 0 0; color:var(--muted); font-size:13px; }
.load-row { display:flex; flex-wrap:wrap; align-items:center; gap:14px; }
.message { min-height:28px; color:#9b3444; font-weight:800; }
.tab { display:none; margin-top:22px; }
.tab.active { display:block; }
.metrics { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:14px; margin-bottom:18px; }
.metrics article,.panel,.cards article,.branch-grid article { background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:0 14px 36px rgba(24,33,47,.07); }
.metrics article { padding:20px; }
.metrics span { display:block; color:var(--muted); font-weight:800; }
.metrics strong { display:block; margin-top:8px; font-size:28px; }
.panel { padding:22px; }
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
.cards em,.branch-grid em { display:block; margin-top:8px; color:#9b3444; font-style:normal; font-weight:800; }
.branch-pos { display:inline-flex; margin-top:12px; color:#9b3444; font-weight:800; }
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
.selected-staff { display:flex; flex-wrap:wrap; gap:8px; margin-top:4px; }
.staff-chip { display:inline-flex; align-items:center; flex-wrap:wrap; gap:8px; min-height:40px; padding:8px 8px 8px 10px; margin:0; color:#9b3444; background:#fff3ef; border:1px solid #eadbd6; border-radius:8px; font-weight:800; }
.staff-chip input { position:absolute; opacity:0; pointer-events:none; width:1px; min-height:1px; margin:0; }
.staff-chip label { display:inline-flex; align-items:center; gap:4px; font-size:12px; }
.staff-chip label input { position:static; opacity:1; pointer-events:auto; width:72px; min-height:30px; margin:0; padding:0 8px; }
.staff-chip button { min-height:26px; width:26px; padding:0; color:#9b3444; background:#fff; border:1px solid #eadbd6; border-radius:6px; }
.table-wrap { overflow-x:auto; }
table { width:100%; min-width:760px; border-collapse:collapse; }
th,td { padding:12px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
th { color:var(--muted); font-size:12px; text-transform:uppercase; }
.pill { display:inline-flex; padding:4px 9px; color:#9b3444; background:#fff3ef; border:1px solid #eadbd6; border-radius:8px; font-weight:800; }
@media (max-width:1000px){ body{grid-template-columns:1fr}.sidebar{position:static;height:auto}.topbar,.split{grid-template-columns:1fr;display:grid}.metrics,.cards,.branch-grid{grid-template-columns:repeat(2,minmax(0,1fr))} }
@media (max-width:640px){ .metrics,.cards,.branch-grid,.grid,fieldset,.staff-checks,.closing-summary{grid-template-columns:1fr}.token{min-width:0} }
`;
}
