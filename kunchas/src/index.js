import { verifyActor, closeWithCounts, saleDetails, editSale } from "./pos-accountability.mjs";
import { posPinHtml, posPinScript } from "./pos-pin-ui.mjs";
import { checkoutBookings } from "./checkout-bookings.mjs";
import { recordCashDrawerOpen } from "./cash-drawer.mjs";
import { brandLogo } from "./brand-logo.mjs";
import { publicBookingRoute } from "./public-booking.mjs";
import { branchWindow, validDate, minutesOf } from "./booking-schedule.mjs";
import { exportServices, importServices } from "./service-excel.mjs";
function escapeAccessHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c])); }
import * as XLSX from "xlsx";
import { accessGate, protectData, publicIdentity, staffRoles, setStaffRole, scopeReportSql, scopeReportParams, can } from "./staff-access.mjs";
import { accessPanelHtml, staffLoginPanelHtml, accessClientScript } from "./access-ui.mjs";

const application = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (["POST", "PATCH"].includes(request.method) && (request.headers.get("content-type") || "").includes("application/json") && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/branches/")) {
        const body = await request.clone().json();
        const branchId = clean(body.branchId) || clean(request.headers.get("x-branch-id"));
        if (branchId && (await all(env, "SELECT id FROM branches WHERE id = ? AND status = 'Archived'", [branchId])).length) return jsonResponse({ error: "This branch is archived. Restore it before making changes." }, 409);
      }

      if (request.method === "GET" && ["/", "/owner", "/admin", "/manager"].includes(url.pathname)) {
        return htmlResponse(renderApp(ctx.identity.managerBranchId || "", "overview", "admin", ctx.identity));
      }

      if (request.method === "GET" && url.pathname === "/pos") {
        return htmlResponse(renderApp("", "pos", "staff", ctx.identity));
      }

      if (request.method === "GET" && url.pathname.startsWith("/pos/")) {
        return htmlResponse(renderApp(clean(url.pathname.replace("/pos/", "")), "pos", "staff", ctx.identity));
      }

      if (request.method === "GET" && url.pathname === "/bookings") {
        return htmlResponse(renderApp("", "bookings", "staff", ctx.identity));
      }

      if (request.method === "GET" && url.pathname.startsWith("/bookings/")) {
        return htmlResponse(renderApp(clean(url.pathname.replace("/bookings/", "")), "bookings", "staff", ctx.identity));
      }

      if (request.method === "GET" && url.pathname === "/api/branches-public") {
        return listPublicBranches(env);
      }

      if (request.method === "GET" && url.pathname === "/api/checkout-bookings") return checkoutBookings(request, env);
      if (request.method === "GET" && url.pathname === "/api/pos-data") {
        const auth = await authorizeBranch(request, env);
        if (auth) return auth;
        return getPosData(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/api/closing-sales') {
        const branchId = clean(request.headers.get('x-branch-id'));
        const date = clean(url.searchParams.get('date'));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({error:'Choose a valid closing date.'},400);
        const [sales, drawerOpens] = await Promise.all([
          all(env,"SELECT s.*,b.name AS branch_name FROM sales s JOIN branches b ON b.id=s.branch_id WHERE s.branch_id=? AND substr(s.created_at,1,10)=? ORDER BY s.created_at DESC",[branchId,date]),
          all(env,"SELECT * FROM cash_drawer_opens WHERE branch_id=? AND substr(opened_at,1,10)=? ORDER BY opened_at DESC",[branchId,date])
        ]);
        return jsonResponse({sales,drawerOpens});
      }
      if (request.method === 'GET' && url.pathname === '/api/recent-sales') {
        const branchId = clean(request.headers.get('x-branch-id'));
        const from = new Date(url.searchParams.get('from'));
        const to = new Date(url.searchParams.get('to'));
        if (!Number.isFinite(+from) || !Number.isFinite(+to) || +to <= +from || +to - +from > 26*60*60*1000) return jsonResponse({error:'Choose a valid sales date.'},400);
        const sales = await all(env,"SELECT s.*,b.name AS branch_name,trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')) AS customer_name,c.phone AS customer_phone,c.email AS customer_email FROM sales s JOIN branches b ON b.id=s.branch_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.branch_id=? AND s.created_at>=? AND s.created_at<? ORDER BY s.created_at DESC",[branchId,from.toISOString(),to.toISOString()]);
        return jsonResponse({sales});
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

      if (request.method === 'POST' && /^\/api\/sales\/[^/]+\/authorize$/.test(url.pathname)) {
        const sale = await env.DB.prepare('SELECT branch_id FROM sales WHERE id=?').bind(decodeURIComponent(url.pathname.split('/')[3])).first();
        if (!sale) return jsonResponse({error:'Sale not found.'},404);
        const auth = await verifyActor(request,env,sale.branch_id,true,true,true);
        return auth.response || jsonResponse({ok:true});
      }
      if (request.method === "GET" && /^\/api\/sales\/[^/]+$/.test(url.pathname)) return saleDetails(request,env,decodeURIComponent(url.pathname.split("/")[3]));
      if (request.method === "PATCH" && /^\/api\/sales\/[^/]+$/.test(url.pathname)) return editSale(request,env,decodeURIComponent(url.pathname.split("/")[3]),paymentLabel);
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
        return closeWithCounts(request, env, expectedClosingTotals, previousRemainingCash);
      }

      if (request.method === "POST" && url.pathname === "/api/cash-drawer-open") return recordCashDrawerOpen(request, env);

      if (request.method === "POST" && url.pathname === "/api/time-clock") {
        const auth = await authorizeBranch(request, env);
        if (auth) return auth;
        return recordTimeClock(request, env);
      }

      if (request.method === "GET" && url.pathname === "/api/app-data") return getAppData(env);
      if (request.method === "GET" && url.pathname === "/api/reports") return getReports(url, env, ctx.identity);
      if (request.method === "GET" && url.pathname === "/api/reports/export") return exportReport(url, env, ctx.identity);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/daily-closing/")) return updateDailyClosing(request, env, clean(url.pathname.replace("/api/daily-closing/", "")));
      if (request.method === "POST" && url.pathname === "/api/customers") return createCustomer(request, env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/customers/")) return updateCustomer(request, env, clean(url.pathname.replace("/api/customers/", "")));
      if (request.method === "POST" && url.pathname === "/api/bookings") return createBooking(request, env);
      if (request.method === "POST" && url.pathname === "/api/services") return createService(request, env);
      if (request.method === "POST" && url.pathname === "/api/services/category-order") return saveServiceCategoryOrder(request, env);
      if (request.method === "PATCH" && url.pathname === "/api/services/category-pin") return setServiceCategoryPin(request, env);
      if (request.method === "PATCH" && url.pathname === "/api/services/category-name") return renameServiceCategory(request, env);
      if (request.method === "PATCH" && url.pathname === "/api/services/subcategory-name") return renameServiceSubCategory(request, env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/services/")) return updateService(request, env, clean(url.pathname.replace("/api/services/", "")));
      if (request.method === "POST" && url.pathname === "/api/products") return createProduct(request, env);
      if (request.method === "POST" && url.pathname === "/api/products/category-order") return saveProductCategoryOrder(request, env);
      if (request.method === "PATCH" && url.pathname === "/api/products/category-name") return renameProductCategory(request, env);
      if (request.method === "PATCH" && url.pathname === "/api/products/subcategory-name") return renameProductSubCategory(request, env);
      if (request.method === "PATCH" && url.pathname === "/api/products/move") return moveProductCategory(request, env);
      if (request.method === "GET" && url.pathname === "/api/services/export") return exportServices(env);
      if (request.method === "POST" && url.pathname === "/api/services/import") return importServices(request, env);
      if (request.method === "GET" && url.pathname === "/api/products/export") return exportProducts(env);
      if (request.method === "POST" && url.pathname === "/api/products/import") return importProducts(request, env);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/products/")) return updateProduct(request, env, clean(url.pathname.replace("/api/products/", "")));
      if (request.method === "POST" && url.pathname === "/api/staff") return createStaff(request, env, ctx.identity);
      if (request.method === "PATCH" && url.pathname.startsWith("/api/staff/")) return updateStaff(request, env, clean(url.pathname.replace("/api/staff/", "")), ctx.identity);
      if (request.method === "POST" && url.pathname === "/api/staff-roster") return saveStaffRoster(request, env);
      if (request.method === "DELETE" && url.pathname === "/api/staff-roster") return deleteStaffRoster(request, env, url);
      if (request.method === "POST" && url.pathname === "/api/staff-regular-days-off") return saveStaffRegularDaysOff(request, env);
      if (request.method === "POST" && url.pathname === "/api/branches") return saveBranch(request, env);
      if (request.method === "POST" && url.pathname.startsWith("/api/branches/") && url.pathname.endsWith("/restore")) return restoreBranch(request, env, clean(url.pathname.split("/")[3]));
      if (request.method === "PATCH" && url.pathname.startsWith("/api/branches/")) return saveBranch(request, env, clean(url.pathname.replace("/api/branches/", "")));
      if (request.method === "DELETE" && url.pathname.startsWith("/api/branches/")) return deleteBranch(request, env, clean(url.pathname.replace("/api/branches/", "")));
      if (request.method === "POST" && url.pathname === "/api/stock-movements") return createStockMovement(request, env);
      if (request.method === "POST" && url.pathname === "/api/branch-hours") return saveBranchHours(request, env);
      if (request.method === "POST" && url.pathname === "/api/closed-dates") return createClosedDate(request, env);
      if (request.method === "POST" && url.pathname === "/api/discounts") return createDiscount(request, env);

      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (String(error.message).includes('BOOKING_CAPACITY')) return jsonResponse({error:'This branch already has four bookings at that time. Please choose another time.'},409);
      console.error(JSON.stringify({ level: "error", message: error.message }));
      return jsonResponse({ error: "Something went wrong. Please try again." }, 500);
    }
  }
};

async function getAppData(env) {
  const [branches, staff, services, serviceCategoryOrder, products, productCategoryOrder, customers, bookings, sales, saleItems, branchHours, closedDates, discounts, inventoryStock, stockMovements, dailyClosings, staffRoster, staffRegularDaysOff, timeEntries] = await Promise.all([
    all(env, "SELECT * FROM branches ORDER BY name"),
    all(env, "SELECT * FROM staff ORDER BY branch_id, name"),
    all(env, "SELECT * FROM services ORDER BY category, name"),
    all(env, "SELECT category, sort_order, pinned FROM service_category_order ORDER BY pinned DESC, sort_order, category"),
    all(env, "SELECT * FROM products ORDER BY category, name"),
    all(env, "SELECT category, sort_order FROM product_category_order ORDER BY sort_order, category"),
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
    all(env, "SELECT * FROM staff_regular_days_off ORDER BY staff_id, day_of_week"),
    all(env, `SELECT te.*, st.name AS staff_name, st.role, st.hourly_rate_cents, br.name AS branch_name
      FROM time_entries te
      LEFT JOIN staff st ON st.id = te.staff_id
      LEFT JOIN branches br ON br.id = te.branch_id
      ORDER BY te.clock_in DESC LIMIT 2000`)
  ]);

  const accessRoles = new Map((await staffRoles(env)).map((row)=>[row.staff_id,row.role]));
  staff.forEach((person)=>person.access_role=accessRoles.get(person.id)||"none");
  return jsonResponse({
    branches,
    staff,
    services,
    serviceCategoryOrder,
    products,
    productCategoryOrder,
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
    staffRegularDaysOff,
    timeEntries
  });
}

async function listPublicBranches(env) {
  const branches = await all(env, "SELECT id, name, address FROM branches WHERE status = 'Open' ORDER BY name");
  return jsonResponse({ branches });
}

async function getPosData(request, env) {
  const branchId = request.headers.get("x-branch-id");
  const [branch, staff, services, serviceCategoryOrder, products, productCategoryOrder, customers, bookings, sales, branchHours, closedDates, dailyClosings, cashDrawerOpens, timeEntries, inventoryStock, stockMovements] = await Promise.all([
    all(env, "SELECT id, name, address, phone, post_code FROM branches WHERE id = ?", [branchId]),
    all(env, `SELECT st.*, br.name AS branch_name
      FROM staff st
      LEFT JOIN branches br ON br.id = st.branch_id
      WHERE st.status = 'Active'
      ORDER BY br.name, st.name`),
    all(env, "SELECT * FROM services WHERE status = 'Active' ORDER BY category, name"),
    all(env, "SELECT category, sort_order, pinned FROM service_category_order ORDER BY pinned DESC, sort_order, category"),
    all(env, "SELECT * FROM products WHERE status = 'Active' ORDER BY category, name"),
    all(env, "SELECT category, sort_order FROM product_category_order ORDER BY sort_order, category"),
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
      ORDER BY dc.closing_date DESC LIMIT 60`, [branchId]),
    all(env, "SELECT * FROM cash_drawer_opens WHERE branch_id=? ORDER BY opened_at DESC LIMIT 200", [branchId]),
    all(env, `SELECT te.*, st.name AS staff_name
      FROM time_entries te
      LEFT JOIN staff st ON st.id = te.staff_id
      WHERE te.branch_id = ? AND te.clock_out IS NULL
      ORDER BY te.clock_in DESC`, [branchId]),
    all(env, `SELECT st.*, p.name AS product_name, p.sku
      FROM inventory_stock st
      LEFT JOIN products p ON p.id = st.product_id
      WHERE st.branch_id = ?
      ORDER BY p.name`, [branchId]),
    all(env, `SELECT sm.*, p.name AS product_name
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      WHERE sm.branch_id = ? AND sm.movement_type = 'Receive'
      ORDER BY sm.created_at DESC LIMIT 50`, [branchId])
  ]);

  return jsonResponse({
    branch: branch[0],
    branches: branch,
    staff,
    services,
    serviceCategoryOrder,
    products,
    productCategoryOrder,
    customers,
    bookings: bookings.map((booking) => ({
      ...booking,
      customer_name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim()
    })),
    sales,
    branchHours,
    closedDates,
    dailyClosings,
    cashDrawerOpens,
    timeEntries,
    inventoryStock,
    stockMovements
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
  let customerId = clean(body.customerId);
  const staffId = clean(body.staffId);
  const serviceIds = Array.isArray(body.serviceIds) ? body.serviceIds.map(clean).filter(Boolean) : [];
  const bookingDate = clean(body.bookingDate);
  const bookingTime = clean(body.bookingTime);

  if (!branchId || !validDate(bookingDate) || !bookingTime || !serviceIds.length) {
    return jsonResponse({ error: "Customer, branch, date, time, and at least one service are required." }, 400);
  }
  const timeMatch = bookingTime.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch || !Number.isFinite(minutesOf(bookingTime)) || Number(timeMatch[2]) % 15 !== 0) {
    return jsonResponse({ error: "Booking time must use a 15-minute interval." }, 400);
  }

  const placeholders = serviceIds.map(() => "?").join(",");
  const serviceRows = await all(env, `SELECT id, name, duration_minutes, price_cents FROM services WHERE id IN (${placeholders})`, serviceIds);
  const totalMinutes = serviceRows.reduce((total, service) => total + Number(service.duration_minutes || 0), 0);
  const totalCents = serviceRows.reduce((total, service) => total + Number(service.price_cents || 0), 0);
  if(serviceRows.length!==serviceIds.length||!Number.isInteger(totalMinutes)||totalMinutes<=0)return jsonResponse({error:'Choose valid services with a duration.'},400);
  const startMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  const window=await branchWindow(env,branchId,bookingDate);
  if (!window || startMinutes < window.start || startMinutes + totalMinutes > window.end) {
    return jsonResponse({ error: "Choose a time within the branch's opening hours and the 10 am–7 pm booking window." }, 400);
  }
  if (await exceedsBookingCapacity(env, branchId, bookingDate, startMinutes, startMinutes + totalMinutes)) {
    return jsonResponse({ error: "This branch already has four bookings at that time. Please select another time." }, 409);
  }

  customerId ||= await ensureBookingCustomer(env, body.customer || {}, branchId, "Online booking");
  if(!customerId)return jsonResponse({error:'Customer details are required.'},400);
  await env.DB.prepare(
    `INSERT INTO bookings (
      id, created_at, updated_at, customer_id, branch_id, staff_id, service_ids,
      service_names, booking_date, booking_time, duration_minutes, total_cents,
      status, payment_status, notes, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      clean(body.notes),
      ["Online", "Manual", "Walk-in"].includes(clean(body.source)) ? clean(body.source) : "Online"
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

async function exceedsBookingCapacity(env, branchId, bookingDate, startMinutes, endMinutes, excludeBookingId = "") {
  const bookings = await all(env, `SELECT id, booking_time, duration_minutes FROM bookings WHERE branch_id = ? AND booking_date = ? AND status NOT IN ('Cancelled', 'No show')`, [branchId, bookingDate]);
  const overlapping = bookings.flatMap((booking) => {
    if (booking.id === excludeBookingId) return [];
    const [hours, minutes] = String(booking.booking_time || "00:00").split(":").map(Number);
    const existingStart = hours * 60 + minutes;
    const existingEnd = existingStart + Math.max(15, Number(booking.duration_minutes || 15));
    return startMinutes < existingEnd && endMinutes > existingStart ? [{ start: existingStart, end: existingEnd }] : [];
  });
  const checkpoints = [startMinutes, ...overlapping.map((booking) => Math.max(startMinutes, booking.start))];
  return checkpoints.some((minute) => overlapping.filter((booking) => minute >= booking.start && minute < booking.end).length >= 4);
}

async function createBranchBooking(request, env) {
  const body = await request.json();
  const branchId = clean(request.headers.get("x-branch-id"));
  let customerId = clean(body.customerId);
  if (customerId) {
    const existing = await env.DB.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
    if (!existing) customerId = "";
  }
  customerId ||= await ensureBookingCustomer(env, body.customer || {}, branchId, "Manual booking");
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
      notes: clean(body.notes),
      source: "Manual"
    })
  });
  return createBooking(bookingRequest, env);
}

async function updateBooking(request, env, bookingId) {
  const record=await env.DB.prepare("SELECT branch_id FROM bookings WHERE id=?").bind(bookingId).first();
  if(!record)return jsonResponse({error:"Booking not found."},404);
  const auth=await verifyActor(request,env,record.branch_id,true);if(auth.response)return auth.response;
  const body = await request.json();
  const existing = (await all(env, "SELECT * FROM bookings WHERE id = ?", [bookingId]))[0];
  if (!existing) return jsonResponse({ error: "Booking not found." }, 404);
  if(body.status!==undefined&&!['Booked','Confirmed','Completed','Cancelled','No show'].includes(clean(body.status)))return jsonResponse({error:'Choose a valid booking status.'},400);
  if((existing.sale_id||existing.status==='Completed')&&['Cancelled','No show'].includes(clean(body.status)))return jsonResponse({error:'A completed booking cannot be cancelled or marked no show. Use the sale refund workflow.'},409);

  const serviceIds = Array.isArray(body.serviceIds) && body.serviceIds.length
    ? body.serviceIds.map(clean).filter(Boolean)
    : JSON.parse(existing.service_ids || "[]");
  const placeholders = serviceIds.map(() => "?").join(",");
  const serviceRows = serviceIds.length ? await all(env, `SELECT id, name, duration_minutes, price_cents FROM services WHERE id IN (${placeholders})`, serviceIds) : [];
  const totalMinutes = Array.isArray(body.serviceIds) ? serviceRows.reduce((total, service) => total + Number(service.duration_minutes || 0), 0) : existing.duration_minutes;
  const totalCents = Array.isArray(body.serviceIds) ? serviceRows.reduce((total, service) => total + Number(service.price_cents || 0), 0) : existing.total_cents;
  const bookingDate = clean(body.bookingDate) || existing.booking_date;
  const bookingTime = clean(body.bookingTime) || existing.booking_time;
  if (body.bookingDate !== undefined || body.bookingTime !== undefined || Array.isArray(body.serviceIds) || (['Cancelled','No show'].includes(existing.status)&&!['Cancelled','No show'].includes(clean(body.status)||existing.status))) {
    const timeMatch = bookingTime.match(/^(\d{2}):(\d{2})$/);
    if (!validDate(bookingDate) || !timeMatch || !Number.isFinite(minutesOf(bookingTime)) || Number(timeMatch[2]) % 15 !== 0) return jsonResponse({ error: "Choose a valid date and a 15-minute booking interval." }, 400);
    const startMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
    const window=await branchWindow(env,existing.branch_id,bookingDate);
    if (!window || startMinutes < window.start || startMinutes + totalMinutes > window.end) return jsonResponse({ error: "Choose a time within the branch's opening hours and the 10 am–7 pm booking window." }, 400);
    const nextStatus = clean(body.status) || existing.status;
    if (!['Cancelled', 'No show'].includes(nextStatus) && await exceedsBookingCapacity(env, existing.branch_id, bookingDate, startMinutes, startMinutes + totalMinutes, bookingId)) return jsonResponse({ error: "This branch already has four bookings at that time. Please select another time." }, 409);
  }

  await env.DB.prepare(
    `UPDATE bookings SET
      updated_at = ?, staff_id = ?, service_ids = ?, service_names = ?,
      booking_date = ?, booking_time = ?, duration_minutes = ?, total_cents = ?,
      status = ?, notes = ?
     WHERE id = ?`
  )
    .bind(
      new Date().toISOString(),
      body.staffId !== undefined ? (clean(body.staffId) || null) : existing.staff_id,
      JSON.stringify(serviceIds),
      Array.isArray(body.serviceIds) ? serviceRows.map((service) => service.name).join(", ") : existing.service_names,
      bookingDate,
      bookingTime,
      totalMinutes,
      totalCents,
      clean(body.status) || existing.status,
      [body.notes !== undefined ? clean(body.notes) : existing.notes, body.status && body.status!==existing.status ? new Date().toISOString()+' — '+body.status+' by '+auth.actor.name+': '+auth.reason : ''].filter(Boolean).join('\n'),
      bookingId
    )
    .run();

  return jsonResponse({ ok: true });
}

async function createService(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  const category = clean(body.category) || "General";
  const subCategory = clean(body.subCategory) || "General";
  const duration = Number(body.durationMinutes || 0);
  const priceCents = Math.round(Number(body.price || 0) * 100);
  if (!name || !duration || !priceCents) return jsonResponse({ error: "Service name, duration, and price are required." }, 400);
  await env.DB.prepare("INSERT INTO services (id, name, category, sub_category, duration_minutes, price_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(`service-${crypto.randomUUID()}`, name, category, subCategory, duration, priceCents, clean(body.status) || "Active")
    .run();
  return jsonResponse({ ok: true });
}

async function saveServiceCategoryOrder(request, env) {
  const body = await request.json();
  const requested = Array.isArray(body.categories) ? body.categories.map(clean).filter(Boolean) : [];
  if (!requested.length || new Set(requested).size !== requested.length) return jsonResponse({ error: "A unique category order is required." }, 400);
  const existing = await all(env, "SELECT DISTINCT category FROM services");
  const available = new Set(existing.map((row) => row.category || "General"));
  if (requested.some((category) => !available.has(category))) return jsonResponse({ error: "The category list is out of date. Refresh and try again." }, 409);
  const saved = await all(env, "SELECT category, pinned FROM service_category_order");
  const savedPins = new Map(saved.map((row) => [row.category, Boolean(row.pinned)]));
  const isPinned = (category) => savedPins.has(category) ? savedPins.get(category) : category.toLowerCase().includes("special");
  const ordered = [...requested.filter(isPinned), ...requested.filter((category) => !isPinned(category))];
  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM service_category_order"),
    ...ordered.map((category, index) => env.DB.prepare("INSERT INTO service_category_order (category, sort_order, pinned, updated_at) VALUES (?, ?, ?, ?)").bind(category, index, isPinned(category) ? 1 : 0, updatedAt))
  ]);
  return jsonResponse({ ok:true, categories:ordered.map((category, sort_order) => ({ category, sort_order, pinned:isPinned(category) ? 1 : 0 })) });
}

async function setServiceCategoryPin(request, env) {
  const body = await request.json();
  const category = clean(body.category);
  const pinned = body.pinned ? 1 : 0;
  if (!category) return jsonResponse({ error:"A service category is required." }, 400);
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM services WHERE category = ?").bind(category).first();
  if (!Number(existing?.count)) return jsonResponse({ error:"Service category not found." }, 404);
  const current = await env.DB.prepare("SELECT sort_order FROM service_category_order WHERE category = ?").bind(category).first();
  const last = current || await env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) AS sort_order FROM service_category_order").first();
  await env.DB.prepare(`INSERT INTO service_category_order (category, sort_order, pinned, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET pinned = excluded.pinned, updated_at = excluded.updated_at`)
    .bind(category, Number(last?.sort_order ?? -1) + (current ? 0 : 1), pinned, new Date().toISOString()).run();
  return jsonResponse({ ok:true, category, pinned });
}

async function renameServiceCategory(request, env) {
  const body = await request.json();
  const oldName = clean(body.oldName);
  const newName = clean(body.newName);
  if (!oldName || !newName) return jsonResponse({ error:"The current and new category names are required." }, 400);
  if (oldName === newName) return jsonResponse({ ok:true, category:newName });
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM services WHERE category = ?").bind(oldName).first();
  if (!Number(existing?.count)) return jsonResponse({ error:"Service category not found." }, 404);
  const orderRows = await all(env, "SELECT category, sort_order, pinned FROM service_category_order WHERE category IN (?, ?)", [oldName, newName]);
  const preservedOrder = orderRows.length ? Math.min(...orderRows.map((row) => Number(row.sort_order))) : null;
  const preservedPin = orderRows.some((row) => Boolean(row.pinned)) ? 1 : 0;
  const statements = [
    env.DB.prepare("UPDATE services SET category = ? WHERE category = ?").bind(newName, oldName),
    env.DB.prepare("DELETE FROM service_category_order WHERE category IN (?, ?)").bind(oldName, newName)
  ];
  if (preservedOrder !== null) statements.push(env.DB.prepare("INSERT INTO service_category_order (category, sort_order, pinned, updated_at) VALUES (?, ?, ?, ?)").bind(newName, preservedOrder, preservedPin, new Date().toISOString()));
  await env.DB.batch(statements);
  return jsonResponse({ ok:true, category:newName });
}

async function renameServiceSubCategory(request, env) {
  const body = await request.json();
  const category = clean(body.category);
  const oldName = clean(body.oldName);
  const newName = clean(body.newName);
  if (!category || !oldName || !newName) return jsonResponse({ error:"The category and sub-category names are required." }, 400);
  if (oldName === newName) return jsonResponse({ ok:true, subCategory:newName });
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM services WHERE category = ? AND sub_category = ?").bind(category, oldName).first();
  if (!Number(existing?.count)) return jsonResponse({ error:"Service sub-category not found." }, 404);
  await env.DB.prepare("UPDATE services SET sub_category = ? WHERE category = ? AND sub_category = ?").bind(newName, category, oldName).run();
  return jsonResponse({ ok:true, subCategory:newName });
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
  const subCategory = clean(body.subCategory) || "General";
  const duration = Number(body.durationMinutes || 0);
  const priceCents = Math.round(Number(body.price || 0) * 100);
  const status = clean(body.status) === "Inactive" ? "Inactive" : "Active";
  if (!name || !Number.isInteger(duration) || duration < 1 || !Number.isInteger(priceCents) || priceCents < 1) {
    return jsonResponse({ error: "Service name, duration, and price are required." }, 400);
  }
  const existing = await env.DB.prepare("SELECT id FROM services WHERE id = ?").bind(serviceId).first();
  if (!existing) return jsonResponse({ error: "Service not found." }, 404);
  await env.DB.prepare("UPDATE services SET name = ?, category = ?, sub_category = ?, duration_minutes = ?, price_cents = ?, status = ? WHERE id = ?")
    .bind(name, category, subCategory, duration, priceCents, status, serviceId)
    .run();
  return jsonResponse({ ok: true });
}

async function createProduct(request, env) {
  const body = await request.json();
  const name = clean(body.name);
  const category = clean(body.category) || "Retail";
  const subCategory = clean(body.subCategory) || "General";
  const sku = clean(body.sku);
  const priceCents = Math.round(Number(body.price || 0) * 100);
  const specialPriceCents = Math.round(Number(body.specialPrice || 0) * 100);
  const costCents = Math.round(Number(body.cost || 0) * 100);
  if (!name || !Number.isInteger(priceCents) || priceCents < 1 || !Number.isInteger(costCents) || costCents < 0 || !Number.isInteger(specialPriceCents) || specialPriceCents < 0 || specialPriceCents >= priceCents && specialPriceCents !== 0) return jsonResponse({ error: "Product name and valid cost, retail, and optional lower special prices are required." }, 400);
  if (sku && !/^\d+$/.test(sku)) return jsonResponse({ error:"SKU must contain numbers only." }, 400);
  const id = `product-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO products (id, name, brand, category, sub_category, sku, barcode, cost_cents, price_cents, special_price_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, name, clean(body.brand), category, subCategory, sku, clean(body.barcode), costCents, priceCents, specialPriceCents, clean(body.status) === "Inactive" ? "Inactive" : "Active")
    .run();
  return jsonResponse({ ok: true, id }, 201);
}

async function updateProduct(request, env, productId) {
  if (!productId) return jsonResponse({ error: "Product is required." }, 400);
  const body = await request.json();
  const name = clean(body.name);
  const category = clean(body.category) || "Retail";
  const subCategory = clean(body.subCategory) || "General";
  const sku = clean(body.sku);
  const priceCents = Math.round(Number(body.price || 0) * 100);
  const specialPriceCents = Math.round(Number(body.specialPrice || 0) * 100);
  const costCents = Math.round(Number(body.cost || 0) * 100);
  if (!name || !Number.isInteger(priceCents) || priceCents < 1 || !Number.isInteger(costCents) || costCents < 0 || !Number.isInteger(specialPriceCents) || specialPriceCents < 0 || specialPriceCents >= priceCents && specialPriceCents !== 0) return jsonResponse({ error: "Product name and valid cost, retail, and optional lower special prices are required." }, 400);
  if (sku && !/^\d+$/.test(sku)) return jsonResponse({ error:"SKU must contain numbers only." }, 400);
  const result = await env.DB.prepare("UPDATE products SET name = ?, brand = ?, category = ?, sub_category = ?, sku = ?, barcode = ?, cost_cents = ?, price_cents = ?, special_price_cents = ?, status = ? WHERE id = ?")
    .bind(name, clean(body.brand), category, subCategory, sku, clean(body.barcode), costCents, priceCents, specialPriceCents, clean(body.status) === "Inactive" ? "Inactive" : "Active", productId)
    .run();
  if (!result.meta.changes) return jsonResponse({ error: "Product not found." }, 404);
  return jsonResponse({ ok: true });
}

async function saveProductCategoryOrder(request, env) {
  const body = await request.json();
  const categories = Array.isArray(body.categories) ? body.categories.map(clean).filter(Boolean) : [];
  if (!categories.length || new Set(categories).size !== categories.length) return jsonResponse({ error:"A unique product category order is required." }, 400);
  const available = new Set((await all(env, "SELECT DISTINCT category FROM products")).map((row) => row.category || "Retail"));
  if (categories.some((category) => !available.has(category))) return jsonResponse({ error:"The product category list is out of date. Refresh and try again." }, 409);
  const updatedAt = new Date().toISOString();
  await env.DB.batch([env.DB.prepare("DELETE FROM product_category_order"), ...categories.map((category, sortOrder) => env.DB.prepare("INSERT INTO product_category_order (category, sort_order, updated_at) VALUES (?, ?, ?)").bind(category, sortOrder, updatedAt))]);
  return jsonResponse({ ok:true, categories });
}

async function renameProductCategory(request, env) {
  const body = await request.json(), oldName = clean(body.oldName), newName = clean(body.newName);
  if (!oldName || !newName) return jsonResponse({ error:"The current and new category names are required." }, 400);
  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM products WHERE category = ?").bind(oldName).first();
  if (!Number(existing?.count)) return jsonResponse({ error:"Product category not found." }, 404);
  const rows = await all(env, "SELECT category, sort_order FROM product_category_order WHERE category IN (?, ?)", [oldName, newName]);
  const sortOrder = rows.length ? Math.min(...rows.map((row) => Number(row.sort_order))) : null;
  const statements = [env.DB.prepare("UPDATE products SET category = ? WHERE category = ?").bind(newName, oldName), env.DB.prepare("DELETE FROM product_category_order WHERE category IN (?, ?)").bind(oldName, newName)];
  if (sortOrder !== null) statements.push(env.DB.prepare("INSERT INTO product_category_order (category, sort_order, updated_at) VALUES (?, ?, ?)").bind(newName, sortOrder, new Date().toISOString()));
  await env.DB.batch(statements);
  return jsonResponse({ ok:true, category:newName });
}

async function renameProductSubCategory(request, env) {
  const body = await request.json(), category = clean(body.category), oldName = clean(body.oldName), newName = clean(body.newName);
  if (!category || !oldName || !newName) return jsonResponse({ error:"The category and sub-category names are required." }, 400);
  const result = await env.DB.prepare("UPDATE products SET sub_category = ? WHERE category = ? AND sub_category = ?").bind(newName, category, oldName).run();
  if (!result.meta.changes) return jsonResponse({ error:"Product sub-category not found." }, 404);
  return jsonResponse({ ok:true, subCategory:newName });
}

async function moveProductCategory(request, env) {
  const body = await request.json(), productId = clean(body.productId), category = clean(body.category), subCategory = clean(body.subCategory) || "General";
  if (!productId || !category) return jsonResponse({ error:"Product and destination category are required." }, 400);
  const result = await env.DB.prepare("UPDATE products SET category = ?, sub_category = ? WHERE id = ?").bind(category, subCategory, productId).run();
  if (!result.meta.changes) return jsonResponse({ error:"Product not found." }, 404);
  return jsonResponse({ ok:true });
}

async function exportProducts(env) {
  const products = await all(env, "SELECT * FROM products ORDER BY category, name");
  const rows = [["Product ID", "Name", "Brand", "Category", "Sub-category", "SKU", "Barcode", "Cost", "Retail Price", "Special Price", "Status"], ...products.map((product) => [
    product.id,
    product.name,
    product.brand || "",
    product.category || "Retail",
    product.sub_category || "General",
    product.sku || "",
    product.barcode || "",
    Number(product.cost_cents || 0) / 100,
    Number(product.price_cents || 0) / 100,
    Number(product.special_price_cents || 0) / 100,
    product.status || "Active"
  ])];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 34 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  sheet["!autofilter"] = { ref: `A1:K${Math.max(rows.length, 1)}` };
  for (let row = 2; row <= rows.length; row += 1) {
    if (sheet[`H${row}`]) sheet[`H${row}`].z = '"$"#,##0.00';
    if (sheet[`I${row}`]) sheet[`I${row}`].z = '"$"#,##0.00';
    if (sheet[`J${row}`]) sheet[`J${row}`].z = '"$"#,##0.00';
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  workbook.Props = { Title:"Kunchas products", Subject:"Product import and export", Company:"Kunchas" };
  const output = XLSX.write(workbook, { type:"array", bookType:"xlsx", compression:true });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(output, { headers:{
    "content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition":`attachment; filename="kunchas-products-${date}.xlsx"`,
    "cache-control":"no-store",
    "x-content-type-options":"nosniff"
  } });
}

function spreadsheetValue(row, names) {
  const key = Object.keys(row).find((candidate) => names.includes(candidate.trim().toLowerCase()));
  return key ? row[key] : "";
}

async function importProducts(request, env) {
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonResponse({ error:"Choose an Excel workbook to import." }, 400);
  if (bytes.byteLength > 5 * 1024 * 1024) return jsonResponse({ error:"The workbook must be smaller than 5 MB." }, 413);
  let workbook;
  try { workbook = XLSX.read(new Uint8Array(bytes), { type:"array", cellDates:false }); }
  catch (_) { return jsonResponse({ error:"The selected file could not be read as an Excel workbook." }, 400); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval:"", raw:true }) : [];
  if (!rows.length) return jsonResponse({ error:"The workbook has no product rows." }, 400);
  if (rows.length > 1000) return jsonResponse({ error:"Import up to 1,000 products at a time." }, 400);
  let created = 0, updated = 0, skipped = 0;
  const errors = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const productId = clean(spreadsheetValue(row, ["product id", "id"]));
    const name = clean(spreadsheetValue(row, ["name", "product name"]));
    const brand = clean(spreadsheetValue(row, ["brand"]));
    const category = clean(spreadsheetValue(row, ["category"])) || "Retail";
    const subCategory = clean(spreadsheetValue(row, ["sub-category", "subcategory", "type"])) || "General";
    const sku = clean(spreadsheetValue(row, ["sku"]));
    const barcode = clean(spreadsheetValue(row, ["barcode"]));
    const costCents = Math.round(Number(spreadsheetValue(row, ["cost", "cost price"]) || 0) * 100);
    const priceCents = Math.round(Number(spreadsheetValue(row, ["retail price", "price", "retail"]) || 0) * 100);
    const specialPriceCents = Math.round(Number(spreadsheetValue(row, ["special price", "sale price", "discount price"]) || 0) * 100);
    const status = clean(spreadsheetValue(row, ["status"])).toLowerCase() === "inactive" ? "Inactive" : "Active";
    if (!name || !Number.isInteger(priceCents) || priceCents < 1 || !Number.isInteger(costCents) || costCents < 0 || !Number.isInteger(specialPriceCents) || specialPriceCents < 0 || specialPriceCents >= priceCents && specialPriceCents !== 0 || sku && !/^\d+$/.test(sku)) {
      skipped += 1;
      errors.push(`Row ${index + 2}: use a product name, numeric SKU, valid retail price, and an optional lower special price.`);
      continue;
    }
    let existing = productId ? await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first() : null;
    if (!existing && sku) existing = await env.DB.prepare("SELECT id FROM products WHERE sku = ? LIMIT 1").bind(sku).first();
    if (!existing && barcode) existing = await env.DB.prepare("SELECT id FROM products WHERE barcode = ? LIMIT 1").bind(barcode).first();
    if (existing) {
      await env.DB.prepare("UPDATE products SET name = ?, brand = ?, category = ?, sub_category = ?, sku = ?, barcode = ?, cost_cents = ?, price_cents = ?, special_price_cents = ?, status = ? WHERE id = ?")
        .bind(name, brand, category, subCategory, sku, barcode, costCents, priceCents, specialPriceCents, status, existing.id).run();
      updated += 1;
    } else {
      await env.DB.prepare("INSERT INTO products (id, name, brand, category, sub_category, sku, barcode, cost_cents, price_cents, special_price_cents, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(`product-${crypto.randomUUID()}`, name, brand, category, subCategory, sku, barcode, costCents, priceCents, specialPriceCents, status).run();
      created += 1;
    }
  }
  return jsonResponse({ ok:true, created, updated, skipped, errors:errors.slice(0, 10) });
}

async function recordTimeClock(request, env) {
  const who=await verifyActor(request,env,request.headers.get("x-branch-id"));if(who.response)return who.response;
  if(who.actor.staffId!==(await request.clone().json()).staffId)return jsonResponse({error:"Use the PIN of the selected staff member."},403);
  const body = await request.json();
  const branchId = clean(request.headers.get("x-branch-id"));
  const staffId = clean(body.staffId);
  const action = clean(body.action).toLowerCase();
  const staff = staffId ? await env.DB.prepare("SELECT id, name FROM staff WHERE id = ? AND status = 'Active'").bind(staffId).first() : null;
  if (!staff || !["clock-in", "break-start", "break-end", "clock-out"].includes(action)) return jsonResponse({ error:"Choose an active staff member and a clock action." }, 400);
  const openEntry = await env.DB.prepare("SELECT * FROM time_entries WHERE staff_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1").bind(staffId).first();
  if (action === "clock-in") {
    if (openEntry) return jsonResponse({ error:`${staff.name} is already clocked in.` }, 409);
    await env.DB.prepare("INSERT INTO time_entries (id, staff_id, branch_id, clock_in, clock_out, notes) VALUES (?, ?, ?, ?, NULL, ?)")
      .bind(`time-${crypto.randomUUID()}`, staffId, branchId, new Date().toISOString(), clean(body.notes)).run();
    return jsonResponse({ ok:true, status:"Clocked in" }, 201);
  }
  if (!openEntry) return jsonResponse({ error:`${staff.name} is not clocked in.` }, 409);
  if (openEntry.branch_id !== branchId) return jsonResponse({ error:`${staff.name} must clock out at the branch where they clocked in.` }, 409);
  const now = new Date();
  if (action === "break-start") {
    if (openEntry.break_started_at) return jsonResponse({ error:`${staff.name} is already on break.` }, 409);
    await env.DB.prepare("UPDATE time_entries SET break_started_at = ? WHERE id = ?").bind(now.toISOString(), openEntry.id).run();
    return jsonResponse({ ok:true, status:"Break started" });
  }
  if (action === "break-end") {
    if (!openEntry.break_started_at) return jsonResponse({ error:`${staff.name} does not have an active break.` }, 409);
    const minutes = Math.max(1, Math.round((now.getTime() - new Date(openEntry.break_started_at).getTime()) / 60000));
    await env.DB.prepare("UPDATE time_entries SET break_started_at = NULL, break_minutes = ? WHERE id = ?").bind(Number(openEntry.break_minutes || 0) + minutes, openEntry.id).run();
    return jsonResponse({ ok:true, status:"Break ended" });
  }
  let breakMinutes = Number(openEntry.break_minutes || 0);
  if (openEntry.break_started_at) breakMinutes += Math.max(1, Math.round((now.getTime() - new Date(openEntry.break_started_at).getTime()) / 60000));
  await env.DB.prepare("UPDATE time_entries SET clock_out = ?, break_started_at = NULL, break_minutes = ?, notes = ? WHERE id = ?")
    .bind(now.toISOString(), breakMinutes, clean(body.notes) || openEntry.notes || "", openEntry.id).run();
  return jsonResponse({ ok:true, status:"Clocked out" });
}

function reportDateRange(url) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
  const from = validDate(url.searchParams.get("from")) ? url.searchParams.get("from") : monthStart;
  const to = validDate(url.searchParams.get("to")) ? url.searchParams.get("to") : today;
  return { from:from <= to ? from : to, to:to >= from ? to : from, branchId:clean(url.searchParams.get("branchId")) };
}

function reportHours(entry) {
  if (!entry.clock_in || !entry.clock_out) return 0;
  return Math.max(0, (new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) / 3600000 - Number(entry.break_minutes || 0) / 60);
}

async function buildReportData(url, env, accessUser) {
  const { from, to, branchId } = reportDateRange(url);
  const scopeParams = scopeReportParams(accessUser);
  const scope = (column) => scopeReportSql(accessUser, column);
  const params = [from, to, branchId, branchId, ...scopeParams];
  const [branches, staff, sales, saleItems, bookings, roster, timeEntries] = await Promise.all([
    all(env, `SELECT * FROM branches WHERE (? = '' OR id = ?)${scope("id")} ORDER BY name`, [branchId, branchId, ...scopeParams]),
    all(env, "SELECT * FROM staff ORDER BY name"),
    all(env, `SELECT s.*, date(s.created_at) AS report_date, br.name AS branch_name FROM sales s LEFT JOIN branches br ON br.id = s.branch_id
      WHERE date(s.created_at) BETWEEN ? AND ? AND (? = '' OR s.branch_id = ?)${scope("s.branch_id")} ORDER BY s.created_at`, params),
    all(env, `SELECT si.*, s.created_at, date(s.created_at) AS report_date, s.branch_id, br.name AS branch_name FROM sale_items si
      JOIN sales s ON s.id = si.sale_id LEFT JOIN branches br ON br.id = s.branch_id
      WHERE date(s.created_at) BETWEEN ? AND ? AND (? = '' OR s.branch_id = ?)${scope("s.branch_id")} ORDER BY s.created_at`, params),
    all(env, `SELECT b.*, br.name AS branch_name FROM bookings b LEFT JOIN branches br ON br.id = b.branch_id
      WHERE b.booking_date BETWEEN ? AND ? AND (? = '' OR b.branch_id = ?)${scope("b.branch_id")} ORDER BY b.booking_date, b.booking_time`, params),
    all(env, `SELECT sr.*, br.name AS branch_name FROM staff_roster sr LEFT JOIN branches br ON br.id = sr.branch_id
      WHERE sr.roster_date BETWEEN ? AND ? AND (? = '' OR sr.branch_id = ?)${scope("sr.branch_id")} AND sr.status = 'Working'`, params),
    all(env, `SELECT te.*, st.name AS staff_name, st.role, st.hourly_rate_cents, st.xero_employee_id, st.xero_earnings_rate_id, br.name AS branch_name
      FROM time_entries te LEFT JOIN staff st ON st.id = te.staff_id LEFT JOIN branches br ON br.id = te.branch_id
      WHERE date(te.clock_in) BETWEEN ? AND ? AND (? = '' OR te.branch_id = ?)${scope("te.branch_id")} ORDER BY te.clock_in`, params)
  ]);

  const branchRows = branches.map((branch) => ({ branchId:branch.id, branch:branch.name, revenueCents:0, transactions:0, productsSold:0, servicesSold:0, onlineBookings:0, manualBookings:0, walkIns:0 }));
  const branchRow = (id) => branchRows.find((row) => row.branchId === id);
  sales.forEach((sale) => { const row = branchRow(sale.branch_id); if (row) { row.revenueCents += Number(sale.total_cents || 0); row.transactions += 1; } });
  saleItems.forEach((item) => { const row = branchRow(item.branch_id); if (row) { if (item.service_id) row.servicesSold += Number(item.quantity || 0); else row.productsSold += Number(item.quantity || 0); } });
  bookings.forEach((booking) => { const row = branchRow(booking.branch_id); if (!row || ["Cancelled", "No show"].includes(booking.status)) return; if (booking.source === "Manual") row.manualBookings += 1; else row.onlineBookings += 1; });
  const bookedSaleIds = new Set(bookings.map((booking) => booking.sale_id).filter(Boolean));
  sales.filter((sale) => !bookedSaleIds.has(sale.id)).forEach((sale) => { const row = branchRow(sale.branch_id); if (row) row.walkIns += 1; });

  const productMap = new Map(), serviceMap = new Map();
  saleItems.forEach((item) => {
    const map = item.service_id ? serviceMap : productMap;
    const key = item.service_id || item.item_name;
    const current = map.get(key) || { name:item.item_name, quantity:0, revenueCents:0 };
    current.quantity += Number(item.quantity || 0);
    current.revenueCents += Number(item.price_cents || 0) * Number(item.quantity || 0);
    map.set(key, current);
  });

  const staffRows = staff.map((person) => ({ staffId:person.id, staff:person.name, role:person.role || "Staff", creditedSalesCents:0, serviceItems:0, managerStoreSalesCents:0 }));
  const staffDailyMap = new Map(), branchDailyMap = new Map();
  const saleDate = (record) => record.report_date || String(record.created_at || "").slice(0, 10);
  const dateBranchKey = (date, id) => JSON.stringify([date, id]);
  for (const sale of sales) {
    const date = saleDate(sale), key = dateBranchKey(date, sale.branch_id);
    const row = branchDailyMap.get(key) || { date, branchId:sale.branch_id, branch:sale.branch_name || "Branch", revenueCents:0, transactions:0, productsSold:0, servicesSold:0 };
    row.revenueCents += Number(sale.total_cents || 0);
    row.transactions += 1;
    branchDailyMap.set(key, row);
  }
  for (const item of saleItems) {
    const row = branchDailyMap.get(dateBranchKey(saleDate(item), item.branch_id));
    if (row) row[item.service_id ? "servicesSold" : "productsSold"] += Number(item.quantity || 0);
  }
  saleItems.forEach((item) => {
    let ids = [], allocations = [];
    try { ids = JSON.parse(item.staff_ids || "[]"); } catch (_) { ids = []; }
    try { allocations = JSON.parse(item.staff_allocations || "[]"); } catch (_) { allocations = []; }
    ids = Array.isArray(ids) ? [...new Set(ids)] : [];
    if (!Array.isArray(allocations)) allocations = [];
    ids.forEach((staffId) => {
      const row = staffRows.find((entry) => entry.staffId === staffId);
      if (!row) return;
      const allocation = allocations.find((entry) => entry.staffId === staffId);
      let credit = Number(allocation?.amountCents || 0);
      if (!credit && Number(allocation?.percent || 0)) credit = Math.round(Number(item.price_cents || 0) * Number(allocation.percent) / 100);
      if (!credit) credit = Math.round(Number(item.price_cents || 0) / Math.max(ids.length, 1));
      row.creditedSalesCents += credit;
      row.serviceItems += item.service_id ? Number(item.quantity || 0) : 0;
      const date = saleDate(item), key = JSON.stringify([date, item.branch_id, staffId]);
      const daily = staffDailyMap.get(key) || { date, staffId, staff:row.staff, role:row.role, branchId:item.branch_id, branch:item.branch_name || "Branch", creditedSalesCents:0, serviceItems:0, saleIds:new Set() };
      daily.creditedSalesCents += credit;
      daily.serviceItems += item.service_id ? Number(item.quantity || 0) : 0;
      daily.saleIds.add(item.sale_id);
      staffDailyMap.set(key, daily);
    });
  });
  const managerDailyRows = [];
  staffRows.filter((row) => /manager/i.test(row.role)).forEach((manager) => {
    const assignments = new Map();
    roster.filter((entry) => entry.staff_id === manager.staffId).forEach((entry) => assignments.set(dateBranchKey(entry.roster_date, entry.branch_id), entry));
    for (const [key, assignment] of assignments) {
      const branchDay = branchDailyMap.get(key);
      const revenueCents = branchDay?.revenueCents || 0;
      manager.managerStoreSalesCents += revenueCents;
      managerDailyRows.push({ date:assignment.roster_date, staffId:manager.staffId, manager:manager.staff, branchId:assignment.branch_id, branch:assignment.branch_name || "Branch", revenueCents, transactions:branchDay?.transactions || 0 });
    }
  });
  const dailyOrder = (left, right) => right.date.localeCompare(left.date) || left.branch.localeCompare(right.branch) || String(left.staff || left.manager || "").localeCompare(String(right.staff || right.manager || ""));
  const staffDailyRows = [...staffDailyMap.values()].map(({ saleIds, ...row }) => ({ ...row, transactions:saleIds.size })).sort(dailyOrder);
  const branchDailyRows = [...branchDailyMap.values()].sort(dailyOrder);
  managerDailyRows.sort(dailyOrder);

  const bookingMap = new Map();
  const addBookingRow = (branch, source, count, valueCents, completed = 0) => {
    const key = `${branch}|${source}`;
    const row = bookingMap.get(key) || { branch, source, count:0, valueCents:0, completed:0 };
    row.count += count; row.valueCents += valueCents; row.completed += completed; bookingMap.set(key, row);
  };
  bookings.filter((booking) => !["Cancelled", "No show"].includes(booking.status)).forEach((booking) => addBookingRow(booking.branch_name || "Branch", booking.source === "Manual" ? "Manual" : "Online", 1, Number(booking.total_cents || 0), booking.status === "Completed" ? 1 : 0));
  sales.filter((sale) => !bookedSaleIds.has(sale.id)).forEach((sale) => addBookingRow(sale.branch_name || "Branch", "Walk-in", 1, Number(sale.total_cents || 0), 1));

  const payrollRows = timeEntries.map((entry) => {
    const hours = reportHours(entry);
    return { id:entry.id, date:String(entry.clock_in || "").slice(0, 10), staffId:entry.staff_id, staff:entry.staff_name || "Staff", role:entry.role || "", branch:entry.branch_name || "Branch", clockIn:entry.clock_in, clockOut:entry.clock_out || "", breakMinutes:Number(entry.break_minutes || 0), hours, hourlyRateCents:Number(entry.hourly_rate_cents || 0), grossPayCents:Math.round(hours * Number(entry.hourly_rate_cents || 0)), xeroEmployeeId:entry.xero_employee_id || "", xeroEarningsRateId:entry.xero_earnings_rate_id || "", status:entry.clock_out ? "Complete" : entry.break_started_at ? "On break" : "Clocked in" };
  });
  const revenueCents = sales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
  return { range:{ from, to, branchId }, summary:{ revenueCents, transactions:sales.length, productsSold:[...productMap.values()].reduce((sum, row) => sum + row.quantity, 0), servicesSold:[...serviceMap.values()].reduce((sum, row) => sum + row.quantity, 0), onlineBookings:bookings.filter((booking) => booking.source !== "Manual" && !["Cancelled", "No show"].includes(booking.status)).length, walkIns:sales.filter((sale) => !bookedSaleIds.has(sale.id)).length, workedHours:payrollRows.reduce((sum, row) => sum + row.hours, 0) }, branchRows, staffRows, staffDailyRows, managerDailyRows, branchDailyRows, productRows:[...productMap.values()], serviceRows:[...serviceMap.values()], bookingRows:[...bookingMap.values()], payrollRows };
}

async function getReports(url, env, accessUser) { return jsonResponse(await buildReportData(url, env, accessUser)); }

function excelReportResponse(name, headers, rows) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!autofilter"] = { ref:`A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(rows.length + 1, 1)}` };
  sheet["!cols"] = headers.map((header) => ({ wch:Math.min(32, Math.max(12, header.length + 3)) }));
  headers.forEach((header, column) => {
    const currency = /sales|rate|pay|value/i.test(header);
    const decimal = /hours/i.test(header);
    for (let row = 2; row <= rows.length + 1; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r:row - 1, c:column })];
      if (cell && currency) cell.z = '"$"#,##0.00';
      else if (cell && decimal) cell.z = "0.00";
    }
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
  const output = XLSX.write(workbook, { type:"array", bookType:"xlsx", compression:true });
  return new Response(output, { headers:{ "content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition":`attachment; filename="kunchas-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx"`, "cache-control":"no-store" } });
}

function csvCell(value) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }

async function exportReport(url, env, accessUser) {
  const report = await buildReportData(url, env, accessUser);
  const type = clean(url.searchParams.get("type"));
  if (type === "staff-daily") return excelReportResponse("Staff Sales by Date", ["Date", "Staff", "Role", "Branch", "Credited Sales", "Services Credited", "Transactions"], report.staffDailyRows.map((row) => [row.date, row.staff, row.role, row.branch, row.creditedSalesCents / 100, row.serviceItems, row.transactions]));
  if (type === "manager-daily") return excelReportResponse("Manager Sales by Date", ["Date", "Manager", "Branch", "Managed Store Sales", "Transactions"], report.managerDailyRows.map((row) => [row.date, row.manager, row.branch, row.revenueCents / 100, row.transactions]));
  if (type === "branch-daily") return excelReportResponse("Branch Sales by Date", ["Date", "Branch", "Total Sales", "Transactions", "Products Sold", "Services Sold"], report.branchDailyRows.map((row) => [row.date, row.branch, row.revenueCents / 100, row.transactions, row.productsSold, row.servicesSold]));
  if (type === "branch") return excelReportResponse("Branch Sales", ["Branch", "Sales", "Transactions", "Products Sold", "Services Sold", "Online Bookings", "Manual Bookings", "Walk-ins"], report.branchRows.map((row) => [row.branch, row.revenueCents / 100, row.transactions, row.productsSold, row.servicesSold, row.onlineBookings, row.manualBookings, row.walkIns]));
  if (type === "staff") return excelReportResponse("Staff and Managers", ["Staff", "Role", "Credited Sales", "Services Sold", "Managed Store Sales"], report.staffRows.map((row) => [row.staff, row.role, row.creditedSalesCents / 100, row.serviceItems, row.managerStoreSalesCents / 100]));
  if (type === "products") return excelReportResponse("Products Sold", ["Product", "Quantity", "Sales"], report.productRows.map((row) => [row.name, row.quantity, row.revenueCents / 100]));
  if (type === "services") return excelReportResponse("Services Sold", ["Service", "Quantity", "Sales"], report.serviceRows.map((row) => [row.name, row.quantity, row.revenueCents / 100]));
  if (type === "bookings") return excelReportResponse("Booking Sources", ["Branch", "Source", "Bookings or Visits", "Value", "Completed"], report.bookingRows.map((row) => [row.branch, row.source, row.count, row.valueCents / 100, row.completed]));
  if (type === "payroll") return excelReportResponse("Payroll Hours", ["Date", "Staff", "Role", "Branch", "Clock In", "Break Minutes", "Clock Out", "Net Hours", "Status"], report.payrollRows.map((row) => [row.date, row.staff, row.role, row.branch, row.clockIn, row.breakMinutes, row.clockOut, Number(row.hours.toFixed(2)), row.status]));
  if (type === "xero") {
    const headers = ["Date", "EmployeeID", "EmployeeName", "EarningsRateID", "NumberOfUnits", "Branch", "ClockIn", "ClockOut"];
    const rows = report.payrollRows.filter((row) => row.clockOut).map((row) => [row.date, row.xeroEmployeeId, row.staff, row.xeroEarningsRateId, row.hours.toFixed(2), row.branch, row.clockIn, row.clockOut]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new Response(csv, { headers:{ "content-type":"text/csv; charset=utf-8", "content-disposition":`attachment; filename="kunchas-xero-timesheets-${report.range.from}-to-${report.range.to}.csv"`, "cache-control":"no-store" } });
  }
  return jsonResponse({ error:"Choose a report to export." }, 400);
}

async function createStaff(request, env, accessUser) {
  const body = await request.json();
  const name = clean(body.name);
  if (!name) return jsonResponse({ error: "Staff name is required." }, 400);
  const id = `staff-${crypto.randomUUID()}`;
  await env.DB.prepare("INSERT INTO staff (id, branch_id, name, role, email, phone, status, hourly_rate_cents, xero_employee_id, xero_earnings_rate_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, "", name, clean(body.role) || "Stylist", clean(body.email), clean(body.phone), clean(body.status) || "Active", Math.max(0, Math.round(Number(body.hourlyRate || 0) * 100)), clean(body.xeroEmployeeId), clean(body.xeroEarningsRateId))
    .run();
  if (body.accessRole !== undefined) await setStaffRole(env, id, body.accessRole, accessUser);
  return jsonResponse({ ok: true, id }, 201);
}

async function updateStaff(request, env, staffId, accessUser) {
  if (!staffId) return jsonResponse({ error: "Staff member is required." }, 400);
  const body = await request.json();
  const name = clean(body.name);
  if (!name) return jsonResponse({ error: "Staff name is required." }, 400);
  const existing = await env.DB.prepare("SELECT * FROM staff WHERE id = ?").bind(staffId).first();
  if (!existing) return jsonResponse({ error: "Staff member not found." }, 404);
  await env.DB.prepare("UPDATE staff SET branch_id = ?, name = ?, role = ?, email = ?, phone = ?, status = ?, hourly_rate_cents = ?, xero_employee_id = ?, xero_earnings_rate_id = ? WHERE id = ?")
    .bind("", name, clean(body.role) || "Stylist", clean(body.email), clean(body.phone), clean(body.status) === "Inactive" ? "Inactive" : "Active", body.hourlyRate === undefined ? existing.hourly_rate_cents : Math.max(0, Math.round(Number(body.hourlyRate || 0) * 100)), body.xeroEmployeeId === undefined ? existing.xero_employee_id : clean(body.xeroEmployeeId), body.xeroEarningsRateId === undefined ? existing.xero_earnings_rate_id : clean(body.xeroEarningsRateId), staffId)
    .run();
  if (body.accessRole !== undefined) await setStaffRole(env, staffId, body.accessRole, accessUser);
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

async function saveBranch(request, env, branchId = "") {
  if(branchId){const auth=await verifyActor(request,env,branchId,true,false);if(auth.response)return auth.response;}
  const body = await request.json();
  const name = clean(body.name), address = clean(body.address), phone = clean(body.phone);
  const postCode = clean(body.postCode), status = clean(body.status) || "Open";
  if (!name || !address || !phone) return jsonResponse({ error: "Branch name, address, and phone are required." }, 400);
  if (!["Open", "Closed"].includes(status)) return jsonResponse({ error: "Invalid branch status." }, 400);
  const hours = body.hours || [], closedDates = body.closedDates || [], removedDates = body.removedDates || [];
  if (!Array.isArray(hours) || !Array.isArray(closedDates) || !Array.isArray(removedDates) || hours.length > 7) return jsonResponse({ error: "Invalid branch schedule." }, 400);
  const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  const seenDays = new Set();
  for (const hour of hours) {
    if (!hour || !Number.isInteger(hour.dayOfWeek) || hour.dayOfWeek < 0 || hour.dayOfWeek > 6 || seenDays.has(hour.dayOfWeek) || (!hour.isClosed && (!timePattern.test(hour.openTime) || !timePattern.test(hour.closeTime) || hour.openTime >= hour.closeTime))) return jsonResponse({ error: "Each open day needs valid opening and closing times, with closing after opening." }, 400);
    seenDays.add(hour.dayOfWeek);
  }
  for (const date of closedDates) {
    const value = clean(date?.closedDate);
    const parsed = new Date(value + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return jsonResponse({ error: "Enter a valid closed date." }, 400);
  }
  if (branchId && !(await all(env, "SELECT id FROM branches WHERE id = ? AND status != 'Archived'", [branchId])).length) return jsonResponse({ error: "Branch not found." }, 404);
  const id = branchId || 'branch-' + crypto.randomUUID();
  const statements = [branchId
    ? env.DB.prepare("UPDATE branches SET name = ?, address = ?, phone = ?, post_code = ?, pin_code = ?, status = ? WHERE id = ?").bind(name, address, phone, postCode, postCode, status, id)
    : env.DB.prepare("INSERT INTO branches (id, name, address, phone, post_code, pin_code, status) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, name, address, phone, postCode, postCode, status)];
  for (const hour of hours) statements.push(env.DB.prepare("INSERT INTO branch_hours (branch_id, day_of_week, open_time, close_time, is_closed) VALUES (?, ?, ?, ?, ?) ON CONFLICT(branch_id, day_of_week) DO UPDATE SET open_time = excluded.open_time, close_time = excluded.close_time, is_closed = excluded.is_closed").bind(id, hour.dayOfWeek, clean(hour.openTime) || "09:00", clean(hour.closeTime) || "17:30", hour.isClosed ? 1 : 0));
  for (const dateId of removedDates) statements.push(env.DB.prepare("DELETE FROM branch_closed_dates WHERE id = ? AND branch_id = ?").bind(clean(dateId), id));
  for (const date of closedDates) statements.push(date.id
    ? env.DB.prepare("UPDATE branch_closed_dates SET closed_date = ?, reason = ? WHERE id = ? AND branch_id = ?").bind(clean(date.closedDate), clean(date.reason) || "Closed", clean(date.id), id)
    : env.DB.prepare("INSERT INTO branch_closed_dates (id, branch_id, closed_date, reason) VALUES (?, ?, ?, ?)").bind('closed-' + crypto.randomUUID(), id, clean(date.closedDate), clean(date.reason) || "Closed"));
  await env.DB.batch(statements);
  return jsonResponse({ ok: true, id }, branchId ? 200 : 201);
}

async function confirmBranchAction(request, env, branchId) {
  const body = await request.json();
  const branch = (await all(env, "SELECT * FROM branches WHERE id = ?", [branchId]))[0];
  if (!branch) return { error: jsonResponse({ error: "Branch not found." }, 404) };
  const expected = clean(env.BRANCH_ADMIN_PIN);
  const supplied = clean(body.pin);
  if (!expected) return { error: jsonResponse({ error: "The admin PIN has not been configured. Contact the administrator." }, 503) };
  if (!supplied) return { error: jsonResponse({ error: "Enter the admin PIN to continue." }, 403) };
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(expected)), crypto.subtle.digest("SHA-256", encoder.encode(supplied))]);
  let different = 0;
  const x = new Uint8Array(left), y = new Uint8Array(right);
  for (let i = 0; i < x.length; i++) different |= x[i] ^ y[i];
  if (different) return { error: jsonResponse({ error: "Incorrect PIN. Nothing has been changed." }, 403) };
  return { body, branch };
}
async function deleteBranch(request, env, branchId) {
  const { body, branch, error } = await confirmBranchAction(request, env, branchId);
  if (error) return error;
  if (body.mode === "archive") {
    await env.DB.prepare("UPDATE branches SET status = 'Archived' WHERE id = ?").bind(branchId).run();
    return jsonResponse({ ok: true, archived: true });
  }
  if (body.mode !== "permanent" || body.confirmName !== branch.name) return jsonResponse({ error: "To permanently delete, enter the branch name exactly." }, 400);
  if (branch.status !== "Archived") return jsonResponse({ error: "Archive this branch before permanently deleting it." }, 409);
  const statements = [
    env.DB.prepare("DELETE FROM customers WHERE branch_id = ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE customer_id = customers.id AND branch_id != ?) AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = customers.id AND branch_id != ?)").bind(branchId, branchId, branchId),
    env.DB.prepare("UPDATE customers SET branch_id = '' WHERE branch_id = ?").bind(branchId),
    env.DB.prepare("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE branch_id = ?)").bind(branchId)
  ];
  for (const table of ["bookings", "sales", "inventory_stock", "stock_movements", "daily_closings", "staff_roster", "time_entries", "branch_hours", "branch_closed_dates"]) statements.push(env.DB.prepare("DELETE FROM " + table + " WHERE branch_id = ?").bind(branchId));
  statements.push(env.DB.prepare("UPDATE staff SET branch_id = '' WHERE branch_id = ?").bind(branchId));
  statements.push(env.DB.prepare("DELETE FROM branches WHERE id = ?").bind(branchId));
  await env.DB.batch(statements);
  return jsonResponse({ ok: true, deleted: true });
}
async function restoreBranch(request, env, branchId) {
  const { branch, error } = await confirmBranchAction(request, env, branchId);
  if (error) return error;
  if (branch.status !== "Archived") return jsonResponse({ error: "This branch is not archived." }, 409);
  await env.DB.prepare("UPDATE branches SET status = 'Closed' WHERE id = ?").bind(branchId).run();
  return jsonResponse({ ok: true });
}

async function createStockMovement(request, env) {
  const body = await request.clone().json();
  const branchId = clean(body.branchId);
  const productId = clean(body.productId);
  const quantity = Number(body.quantity || 0);
  const movementType = clean(body.movementType) || "Receive";
  const allowedTypes = ["Receive", "Adjustment in", "Adjustment out", "Transfer in", "Transfer out"];
  if (!branchId || !productId || !Number.isSafeInteger(quantity) || quantity < 1) return jsonResponse({ error: "Branch, product, and a positive whole quantity are required." }, 400);
  if (!allowedTypes.includes(movementType)) return jsonResponse({ error: "Choose a valid stock movement type." }, 400);
  const [branch, product] = await Promise.all([
    env.DB.prepare("SELECT id FROM branches WHERE id = ? AND status = 'Open'").bind(branchId).first(),
    env.DB.prepare("SELECT id FROM products WHERE id = ? AND status = 'Active'").bind(productId).first()
  ]);
  if (!branch || !product) return jsonResponse({ error: "Choose an open branch and active product." }, 400);
  let reason = clean(body.reason);
  if (request.headers.get("x-pos-workspace") === "1") {
    if (movementType !== "Receive") return jsonResponse({ error: "The POS can only receive product deliveries." }, 400);
    const auth = await verifyActor(request, env, branchId);
    if (auth.response) return auth.response;
    const account = await env.DB.prepare("SELECT u.role, r.permissions FROM access_users u LEFT JOIN access_roles r ON r.role = u.role WHERE u.id = ?").bind(auth.actor.id).first();
    let permissions = {};
    try { permissions = JSON.parse(account?.permissions || "{}"); } catch { permissions = {}; }
    if (account?.role !== "owner" && Number(permissions.inventory || 0) < 2) return jsonResponse({ error: "Your account does not have permission to receive inventory." }, 403);
    reason = [reason, `Received by ${auth.actor.name}`].filter(Boolean).join(" · ");
  }
  const delta = movementType === "Sale" || movementType === "Transfer out" || movementType === "Adjustment out" ? -Math.abs(quantity) : Math.abs(quantity);
  await applyStockMovement(env, branchId, productId, delta, movementType, reason, clean(body.reference));
  return jsonResponse({ ok: true, quantityReceived:delta });
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
  const record=await env.DB.prepare("SELECT branch_id FROM daily_closings WHERE id=?").bind(closingId).first();
  if(!record)return jsonResponse({error:"Closing not found."},404);
  const auth=await verifyActor(request,env,record.branch_id,true);if(auth.response)return auth.response;
  const body = await request.json();
  body.approvedBy=auth.actor.name;
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
  const body = await request.clone().json();
  const auth=await verifyActor(request,env,clean(body.branchId),false,false,false,true);if(auth.response)return auth.response;
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
  const productRows = productIds.length ? await all(env, `SELECT id, name, price_cents, special_price_cents FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`, productIds) : [];
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
        priceCents: !isProduct && instancePriceCents > 0 ? instancePriceCents : isProduct && Number(record.special_price_cents || 0) > 0 ? Number(record.special_price_cents) : Number(record.price_cents || 0),
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
    const creditedTotal = item.staffAllocations.reduce((sum, allocation) => sum + (allocation.amountCents || Math.round(item.priceCents * allocation.percent / 100)), 0);
    if (percentTotal > 100) return jsonResponse({ error: `Staff percentages for ${item.name} cannot exceed 100%.` }, 400);
    if (amountTotal > item.priceCents) return jsonResponse({ error: `Staff dollar allocations for ${item.name} cannot exceed ${formatDollars(item.priceCents)}.` }, 400);
    if (creditedTotal > item.priceCents + 1) return jsonResponse({ error: `Staff allocations for ${item.name} cannot exceed the service amount.` }, 400);
    if (item.staffAllocations.some((allocation) => allocation.percent > 0 && allocation.amountCents > 0 && Math.abs(allocation.amountCents - Math.round(item.priceCents * allocation.percent / 100)) > 1)) {
      return jsonResponse({ error: `Staff percentages and amounts for ${item.name} must match.` }, 400);
    }
  }
  const totalCents = saleItems.reduce((total, item) => total + item.priceCents, 0);
  const supportedPaymentMethods = ["Cash", "Card", "Bank Transfer", "Store Credit", "Gift Voucher", "Refund", "On Account"];
  let submittedPayments = Array.isArray(body.payments) ? body.payments : [];
  if (!submittedPayments.length && clean(body.paymentMethod)) submittedPayments = [{ method:clean(body.paymentMethod), amount:body.tenderAmount }];
  if (!submittedPayments.length || submittedPayments.length > 20) return jsonResponse({ error: "Add at least one valid payment." }, 400);
  const normalizedPayments = submittedPayments.map((payment) => ({ method:clean(payment?.method), amountCents:Math.round(Number(payment?.amount || 0) * 100) }));
  if (normalizedPayments.some((payment) => !supportedPaymentMethods.includes(payment.method) || !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0)) {
    return jsonResponse({ error: "Every payment needs a valid method and positive amount." }, 400);
  }
  const payments = supportedPaymentMethods.map((method) => ({
    method,
    amountCents:normalizedPayments.filter((payment) => payment.method === method).reduce((sum, payment) => sum + payment.amountCents, 0)
  })).filter((payment) => payment.amountCents > 0);
  const tenderedCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const cashCents = payments.filter((payment) => payment.method === "Cash").reduce((sum, payment) => sum + payment.amountCents, 0);
  const cardCents = payments.filter((payment) => payment.method === "Card").reduce((sum, payment) => sum + payment.amountCents, 0);
  const changeCents = Math.max(0, tenderedCents - totalCents);
  if (!Number.isSafeInteger(tenderedCents) || tenderedCents < totalCents) return jsonResponse({ error: `Payment is short by ${formatDollars(totalCents - tenderedCents)}.` }, 400);
  if (changeCents > cashCents) return jsonResponse({ error: "Only cash can exceed the remaining balance and produce change." }, 400);
  const paymentMethod = payments.map((payment) => `${payment.method} ${formatDollars(payment.amountCents)}`).join(" / ") + (changeCents ? ` / change ${formatDollars(changeCents)}` : "");

  const saleStatements = [env.DB.prepare(
    `INSERT INTO sales (id, created_at, branch_id, customer_id, staff_id, total_cents, payment_method, status, recorded_by_id, recorded_by_name, cash_cents, card_cents, change_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      now,
      branchId,
      customerId || null,
      null,
      totalCents,
      paymentMethod,
      "Paid",auth.actor.id,auth.actor.name,cashCents,cardCents,changeCents
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
  return jsonResponse({ ok: true, saleId: id, bookingId: booking?.id || null, totalCents, receipt: { saleId: id, bookingId: booking?.id || null, branchId, createdAt: now, branch, items: saleItems, totalCents, cashCents, cardCents, changeCents, paymentMethod, payments } });
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
  const rows = await all(env, "SELECT total_cents, payment_method, cash_cents, card_cents, change_cents FROM sales WHERE branch_id = ? AND substr(created_at, 1, 10) = ? AND status = 'Paid'", [branchId, closingDate]);
  return rows.reduce((totals, sale) => {
    if (sale.cash_cents != null && sale.card_cents != null) { totals.cashCents += Number(sale.cash_cents) - Number(sale.change_cents || 0); totals.cardCents += Number(sale.card_cents); return totals; }
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

// Operational requests have already passed the central session and permission gate.
async function authorizeBranch() { return null; }
async function authorizeSale() { return null; }
async function authorizeBookingEdit() { return null; }

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

function bookingTimeOptions() {
  const options = [];
  for (let minutes = 600; minutes < 1140; minutes += 15) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    const label = `${hours % 12 || 12}:${String(mins).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
    const value = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    options.push(`<option value="${value}">${label}</option>`);
  }
  return '<option value="">Select time</option>' + options.join("");
}

function renderApp(initialBranchId, initialTab, mode = "admin", accessUser) {
  const isAdmin = mode === "admin";
  const dashboardTitle = accessUser.role === "owner" ? "SuperAdmin Dashboard (Owner)" : accessUser.role === "manager" ? "Manager Dashboard" : "Admin Dashboard";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${isAdmin ? dashboardTitle : "Branch POS"} · Kuncha’s</title>
  <style>${styles()}</style>
</head>
<body class="${isAdmin ? "admin-mode" : "staff-mode pos-locked"}">
  <aside class="sidebar">
    <div class="brand"><img src="${brandLogo}" alt="Kuncha’s Hair & Beauty Art" width="2551" height="1189"></div>
    <nav>
      ${isAdmin ? `
      <button ${(can(accessUser, "dashboard")) ? "" : "hidden"} class="nav ${initialTab === "overview" ? "active" : ""}" data-tab="overview">${appIcon("dashboard")}<span>Dashboard</span></button>
      <button ${(can(accessUser, "customers")) ? "" : "hidden"} class="nav" data-tab="customers">${appIcon("customers")}<span>Customers</span></button>
      <button ${(can(accessUser, "staff")) ? "" : "hidden"} class="nav" data-tab="staff">${appIcon("staff")}<span>Staff</span></button>
      <button ${(can(accessUser, "roster")) ? "" : "hidden"} class="nav" data-tab="roster">${appIcon("roster")}<span>Roster</span></button>
      <button ${(can(accessUser, "services")) ? "" : "hidden"} class="nav" data-tab="services">${appIcon("services")}<span>Services</span></button>
      <button ${(can(accessUser, "products")) ? "" : "hidden"} class="nav" data-tab="products">${appIcon("products")}<span>Products</span></button>
      <button ${(can(accessUser, "inventory")) ? "" : "hidden"} class="nav" data-tab="inventory">${appIcon("inventory")}<span>Inventory</span></button>
      <button ${(can(accessUser, "reports") || can(accessUser, "payroll")) ? "" : "hidden"} class="nav" data-tab="reports">${appIcon("reports")}<span>Reports</span></button>
      <button ${(can(accessUser, "branches")) ? "" : "hidden"} class="nav" data-tab="branches">${appIcon("branches")}<span>Branches</span></button>
      <button ${(["owner", "admin"].includes(accessUser.role) && can(accessUser, "access", true)) ? "" : "hidden"} class="nav" data-tab="access">${appIcon("access")}<span>Access</span></button>` : `
      <button class="nav ${initialTab === "pos" ? "active" : ""}" data-tab="pos">${appIcon("pos")}<span>POS</span></button>
      <button class="nav" data-tab="receive-products">${appIcon("inventory")}<span>Receive products</span></button>
      <button class="nav ${initialTab === "bookings" ? "active" : ""}" data-tab="bookings">${appIcon("bookings")}<span>Bookings</span></button>
      <button class="nav" data-tab="closing">${appIcon("closing")}<span>Daily Closing</span></button>
      <button class="nav" data-tab="recent-sales">${appIcon("sales")}<span>Recent Sales</span></button>
      <button class="nav" data-tab="staff-clock">${appIcon("staff")}<span>Staff</span></button>`}
    </nav>
    <div class="sidebar-footer staff-only"><button class="nav" id="switchBranch" type="button">${appIcon("branches")}<span>Change branch</span></button><button class="nav" id="managerDashboardButton" type="button">${appIcon("dashboard")}<span>Manager dashboard</span></button></div>
  </aside>

  <main class="app">
    <header class="topbar">
      <div>
        <p class="eyebrow">${isAdmin ? dashboardTitle : "Branch POS"}</p>
        <h1 id="appTitle">${isAdmin ? dashboardTitle : "Kunchas branch"}</h1>
      </div>
      ${isAdmin ? `<div class="admin-controls"><button class="secondary" id="printLastReceiptButton" type="button" disabled>Print last receipt</button><label class="branch-switcher"><span>Viewing</span><select id="globalBranchFilter" aria-label="Choose branch"><option value="">All branches</option></select></label><details class="account-dropdown" id="accountDropdown"><summary class="admin-avatar" aria-label="Account menu"><span>${escapeAccessHtml(accessUser.name.slice(0,2).toUpperCase())}</span><strong>${escapeAccessHtml(accessUser.name)}</strong><b aria-hidden="true">⌄</b></summary><div class="account-dropdown-panel"><p>${escapeAccessHtml(dashboardTitle)}</p><button type="button" id="changePinButton">Change PIN</button><button type="button" id="signOutButton">Sign out</button></div></details></div>` : ""}
    </header>
    ${isAdmin ? "" : '<div class="account-tools"><button class="secondary" id="printLastReceiptButton" type="button" disabled>Print last receipt</button><button class="secondary" type="button" id="changePinButton">Change my PIN</button><button class="secondary" type="button" id="signOutButton">Sign out</button></div>'}

    <dialog id="changePinDialog" class="branch-dialog branch-action-dialog"><form id="changePinForm"><div class="branch-dialog-header"><h2>Change my PIN</h2></div><div class="branch-dialog-body"><label>Current PIN<input name="currentPin" type="password" inputmode="numeric" autocomplete="current-password" required></label><label>New PIN<input name="newPin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6,12}" required></label><label>Confirm new PIN<input name="confirmPin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6,12}" required></label><p class="hint">Use 6–12 digits. You will sign in again after changing it.</p><p id="changePinMessage" role="alert"></p></div><div class="branch-dialog-footer"><button class="secondary" type="button" id="cancelPinChange">Cancel</button><button class="primary" type="submit">Change PIN</button></div></form></dialog>
    <dialog id="managerDashboardDialog" class="branch-dialog branch-action-dialog"><form id="managerDashboardForm"><div class="branch-dialog-header"><div><p class="eyebrow">Manager access</p><h2>Open manager dashboard</h2></div></div><div class="branch-dialog-body"><label>Manager PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{6,12}" required autofocus></label><p class="hint">Your manager PIN opens only this branch. Menus and editing follow the permissions set by the owner.</p><p id="managerDashboardError" role="alert"></p></div><div class="branch-dialog-footer"><button class="secondary" type="button" id="cancelManagerDashboard">Cancel</button><button class="primary" type="submit">Open dashboard</button></div></form></dialog>
    <dialog id="checkoutCompleteDialog" class="branch-dialog branch-action-dialog" aria-labelledby="checkoutCompleteTitle"><form method="dialog"><div class="branch-dialog-header"><div><p class="eyebrow">Checkout complete</p><h2 id="checkoutCompleteTitle">Would you like a receipt?</h2></div></div><div class="branch-dialog-body"><p id="checkoutCompleteSummary"></p><div class="checkout-complete-actions"><button class="primary" id="checkoutPrintReceipt" type="button">Print receipt</button><button class="secondary" id="openCashDrawer" type="button" hidden>Open cash drawer</button></div><p class="hint" id="cashDrawerStatus" role="status"></p></div><div class="branch-dialog-footer"><button class="secondary" id="declineReceipt" type="submit" value="no-receipt">No receipt</button></div></form></dialog>
    <div class="load-row admin-only">
      <button class="primary" id="loadData" type="button">Refresh data</button>
    </div>
    <p class="message" id="message">${isAdmin ? "Loading your data." : "Choose a branch to open your workspace."}</p>

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

    ${posPinHtml()}<div class="panel pos-login staff-only" id="posLogin">
      <img class="login-brand-logo" src="${brandLogo}" alt="Kuncha’s Hair & Beauty Art" width="2551" height="1189">
      <h2>Sign in to your branch</h2>
      <p class="hint">Choose a branch and enter its branch PIN. Each purchase and closing requires an individual staff PIN.</p>
      <div class="grid">
        <label>Branch name<select id="posBranch" required></select></label>
        <label>Login PIN<input type="password" id="posPin" inputmode="numeric" autocomplete="off" required></label>
      </div>
      <button class="primary full" id="openPos" type="button">Log in</button>
    </div>

    <section class="tab staff-only ${initialTab === "pos" ? "active" : ""}" id="pos">
      <div class="pos-workspace hidden" id="posWorkspace">
      <div class="pos-branch-bar">
        <div>
          <p class="eyebrow">Current branch</p>
          <h2 id="posBranchName">Branch POS</h2>
        </div>
      </div>
      <div class="split">
        <form class="panel" id="saleForm" novalidate>
          <p class="eyebrow">Point of sale</p><h2>New sale</h2>
          <input name="branchId" type="hidden">
          <input name="bookingId" type="hidden">
          <label>Search bookings<input id="bookingCheckoutSearch" type="search" placeholder="Search customer, phone, service or date" aria-controls="bookingCheckout"></label><p class="hint" id="bookingCheckoutSearchStatus" role="status">Today’s bookings. Search to find previous dates.</p><label>Checkout a booking<select id="bookingCheckout"><option value="">New walk-in sale</option></select></label>
          <p class="hint booking-checkout-hint">Choose an unpaid booking to preload its customer, services, and assigned staff.</p>
          <label>Customer type<select name="customerMode"><option value="walkin">Walking customer</option><option value="existing">Existing customer</option><option value="new">Add new customer</option></select></label>
          <div class="customer-existing hidden">
            <label>Customer search<input name="customerSearch" list="customerList" placeholder="Type name, phone, or email"></label>
          </div>
          <div class="booking-customer-card hidden" id="bookingCustomerCard" aria-live="polite"></div>
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
          <div class="checkout-total"><span>Total amount</span><strong id="checkoutTotal">$0.00</strong></div>
          <button class="primary full pay-button" id="showPaymentMethods" type="button">Click to pay</button>
          <div class="payment-panel hidden" id="paymentPanel">
            <div class="payment-heading"><div><p class="eyebrow">Make a payment</p><h3>Select payment method</h3></div><label>Amount to pay $<input name="paymentAmount" type="number" min="0.01" step="0.01" placeholder="0.00"></label></div>
            <div class="payment-methods" role="group" aria-label="Payment method">
              <button type="button" data-payment-method="Cash">Cash</button>
              <button type="button" data-payment-method="Card">Card</button>
              <button type="button" data-payment-method="Bank Transfer">Bank transfer</button>
              <button type="button" data-payment-method="Store Credit">Store credit</button>
              <button type="button" data-payment-method="Gift Voucher">Gift voucher</button>
              <button type="button" data-payment-method="Refund">Refund</button>
              <button type="button" data-payment-method="On Account">On account</button>
            </div>
            <p class="hint" id="selectedPaymentMethod">Enter an amount, then choose how it was paid.</p>
            <div class="payment-allocations" id="paymentAllocations"></div>
            <div class="payment-balance" id="paymentBalance"></div>
          </div>
          <button class="primary full hidden" id="completeSale" type="submit" disabled>Complete payment</button>
          <p class="sale-message" id="saleMessage" aria-live="polite"></p>
        </form>
        <div class="panel cart-panel"><h2>Sale summary</h2><div id="cartSummary" class="cart-summary"></div><div class="cart-total"><span>Total</span><strong id="cartTotal">$0.00</strong></div><div class="cart-payment-summary" id="cartPaymentSummary"></div></div>
      </div>
      </div>
    </section>

    <section class="tab staff-only" id="receive-products">
      <div class="receive-workspace hidden" id="receiveWorkspace">
        <div class="section-heading page-heading"><div><p class="eyebrow">Branch inventory</p><h2>Receive products</h2><p class="hint">Record delivered stock against this branch. An individual staff PIN with inventory permission is required.</p></div></div>
        <div class="split receive-products-layout">
          <form class="panel" id="receiveProductsForm">
            <input name="branchId" type="hidden">
            <input name="movementType" type="hidden" value="Receive">
            <label>Product<select name="productId" required></select></label>
            <div class="grid"><label>Quantity received<input name="quantity" type="number" min="1" step="1" required></label><label>Invoice / delivery reference<input name="reference" maxlength="500" placeholder="Invoice or delivery number"></label></div>
            <label>Delivery note<input name="reason" maxlength="500" placeholder="Supplier, damaged cartons, or other note"></label>
            <button class="primary full" type="submit">Receive into products</button>
            <p class="sale-message" id="receiveProductsMessage" role="status"></p>
          </form>
          <div class="panel"><div class="section-heading"><div><h2>Current product stock</h2><p class="hint">Stock on hand at this branch after sales and receipts.</p></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>On hand</th></tr></thead><tbody id="receiveProductsStock"></tbody></table></div></div>
        </div>
        <div class="panel"><div class="section-heading"><div><h2>Recent deliveries</h2><p class="hint">The latest 50 product receipts for this branch.</p></div></div><div class="table-wrap"><table><thead><tr><th>Received</th><th>Product</th><th>Quantity</th><th>Reference</th><th>Details</th></tr></thead><tbody id="receiveProductsHistory"></tbody></table></div></div>
      </div>
    </section>

    <section class="tab staff-only" id="staff-clock">
      <div class="pos-workspace hidden" id="staffWorkspace">
        <div class="panel time-clock-panel"><div><p class="eyebrow">Staff time clock</p><h2>Clock in, take a break, or clock out</h2><p class="hint" id="timeClockStatus">Actual hours feed the payroll report.</p></div><label>Staff<select id="timeClockStaff" data-staff-select></select></label><div class="time-clock-actions"><button class="primary" id="clockInButton" type="button">Clock in</button><button class="secondary" id="breakStartButton" type="button">Start break</button><button class="secondary" id="breakEndButton" type="button">End break</button><button class="secondary" id="clockOutButton" type="button">Clock out</button></div></div>
        <div class="panel"><div class="section-heading"><div><h2>Clocked-in staff</h2><p class="hint">Everyone currently working at this branch remains visible here.</p></div><span class="pill" id="clockedInCount">0 clocked in</span></div><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Clocked in</th><th>Status</th><th>Break minutes</th></tr></thead><tbody id="clockedInStaffTable"></tbody></table></div></div>
      </div>
    </section>

    <section class="tab staff-only" id="recent-sales">
      <div class="panel"><h2>Recent sales</h2><div class="grid"><label>Sales date<input id="recentSalesDate" type="date" required></label><label>Search customer<input id="recentSalesSearch" type="search" placeholder="Customer name, phone or email"></label></div><button class="secondary" id="recentSalesToday" type="button">Today</button><p class="hint" id="recentSalesStatus" role="status"></p><div class="table-wrap"><table><thead><tr><th>Time</th><th>Customer</th><th>Total</th><th>Method</th><th>Status</th><th>Completed by</th><th>Edit</th></tr></thead><tbody id="salesTable"></tbody></table></div><p class="hint">Sale edits require this branch’s manager PIN and a reason.</p></div>
    </section>

    <section class="tab staff-only ${initialTab === "bookings" ? "active" : ""}" id="bookings">
      <div class="split">
        <form class="panel" id="bookingForm">
          <h2>New booking</h2>
          <input name="branchId" type="hidden">
          <div class="grid"><label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label></div>
          <div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div>
          <label>Staff<select name="staffId"></select></label>
          <div class="grid"><label>Date<input name="bookingDate" type="date" required></label><label>Time<select name="bookingTime" required>${bookingTimeOptions()}</select></label></div>
          <div class="booking-service-picker"><span class="field-label">Services</span><input id="bookingServiceSearch" type="text" placeholder="Click to choose a category" readonly role="combobox" aria-expanded="false" aria-controls="bookingServiceMenu"><div class="booking-service-menu hidden" id="bookingServiceMenu"><div class="booking-service-categories" id="bookingServiceCategories"></div><div class="booking-category-services hidden" id="bookingCategoryServices"></div></div><div class="selected-booking-services" id="bookingSelectedServices"></div><div class="booking-service-total"><span>Total</span><strong id="bookingServiceTotal">$0.00</strong></div></div>
          <label>Notes<textarea name="notes" rows="3"></textarea></label>
          <button class="primary full" type="submit">Save booking</button>
        </form>
        <div class="panel diary-panel"><div class="booking-date-heading"><div><h2>Booking diary</h2><p class="hint">Four booking columns · maximum four concurrent bookings per branch · 15-minute intervals · 10:00 am–7:00 pm.</p></div><div class="diary-date-controls"><button class="secondary" id="bookingToday" type="button">Today</button><button class="secondary" id="bookingPreviousDay" type="button" aria-label="Previous day">Previous</button><button class="secondary" id="bookingNextDay" type="button" aria-label="Next day">Next</button><label>Date<input id="bookingDisplayDate" type="date"></label></div></div><div class="booking-legend"><span><i class="online"></i>Online</span><span><i class="manual"></i>Manual</span></div><div class="booking-diary" id="bookingsTable"></div><div class="booking-detail hidden" id="bookingDetail"></div></div>
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
      <div class="section-heading page-heading"><div><p class="eyebrow">Your team</p><h2>Staff</h2><p class="hint">Manage staff details, access and working hours.</p></div><button class="primary" id="addStaffButton" type="button" aria-controls="staffForm" aria-expanded="false">+ Add staff</button></div>
      <div class="staff-directory">
        <form class="panel staff-editor" id="staffForm" hidden><div class="section-heading"><h2>Add staff</h2><button class="secondary" id="cancelStaffAdd" type="button">Cancel</button></div><input name="staffId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Job title<input name="role" placeholder="Senior stylist"></label></div><div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div><div class="grid"><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label></div><details class="xero-fields"><summary>Xero payroll IDs</summary><div class="grid"><label>Employee ID<input name="xeroEmployeeId"></label><label>Earnings rate ID<input name="xeroEarningsRateId"></label></div></details><label data-access-role-control>Access role<select name="accessRole"><option value="none">No access</option><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>${staffLoginPanelHtml()}<fieldset class="day-off-fieldset"><legend>Regular day off</legend><p class="hint">Choose their usual weekly day or days off.</p><div class="day-checks" data-day-off-checks></div></fieldset><button class="primary full" type="submit">Save staff</button></form>
        <div class="panel"><div class="section-heading staff-list-heading"><div><h3>Team directory</h3><p class="hint" id="staffCount" aria-live="polite"></p></div><div class="staff-list-filters"><label>Search staff<input id="staffSearch" type="search" placeholder="Name, role, email or phone"></label><label>Status<select id="staffStatusFilter"><option value="">All statuses</option><option>Active</option><option>Inactive</option></select></label></div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Day off</th><th>Status</th><th>Sales made</th></tr></thead><tbody id="staffTable"></tbody></table></div></div>
      </div>
      <div class="panel staff-profile hidden" id="staffProfile"><div class="profile-heading"><div><h2 id="staffProfileTitle">Staff details</h2><p class="hint" id="staffProfileSummary"></p></div><button class="secondary" id="closeStaffProfile" type="button">Close</button></div><form id="staffProfileForm"><input name="staffId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Job title<input name="role"></label></div><div class="grid"><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label></div><div class="grid"><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label></div><details class="xero-fields"><summary>Xero payroll IDs</summary><div class="grid"><label>Employee ID<input name="xeroEmployeeId"></label><label>Earnings rate ID<input name="xeroEarningsRateId"></label></div></details><label data-access-role-control>Access role<select name="accessRole"><option value="none">No access</option><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>${staffLoginPanelHtml()}<fieldset class="day-off-fieldset"><legend>Regular day off</legend><div class="day-checks" data-day-off-checks></div></fieldset><button class="primary" type="submit">Save staff details</button></form><h3>Credited sales history</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Service</th><th>Sale value</th><th>Staff credit</th></tr></thead><tbody id="staffSalesTable"></tbody></table></div><div class="staff-hours-section"><div class="section-heading"><div><h3>Daily hours</h3><p class="hint">Last 14 days · Net hours exclude recorded breaks.</p></div><strong id="staffHoursSummary"></strong></div><div class="table-wrap"><table class="staff-hours-table"><thead><tr><th>Date</th><th>Branch</th><th>Clock in</th><th>Break</th><th>Clock out</th><th>Total hours</th></tr></thead><tbody id="staffHoursTable"></tbody></table></div></div></div>
    </section>
    <section class="tab admin-only" id="roster">
      <div class="panel roster-day-panel"><div class="roster-toolbar"><div><p class="eyebrow">Schedule builder</p><h2 id="rosterDayTitle">Branch roster</h2><p class="hint">Choose one branch, then add or adjust staff shifts for the selected day.</p></div><div class="roster-toolbar-controls"><label>Branch<select id="rosterBranchSelect" aria-label="Roster branch"></select></label><label>Date<input id="rosterDay" type="date"></label></div></div><div class="roster-branch-board" id="rosterBranchBoard"></div></div>
      <div class="panel roster-calendar-panel"><div class="roster-toolbar"><div><h2>Roster calendar</h2><p class="hint">See coverage and bookings at a glance, then choose a day to edit above.</p></div><label>Month<input id="rosterMonth" type="month"></label></div><div class="month-calendar" id="rosterMonthCalendar"></div></div>
    </section>
    <section class="tab admin-only" id="services">
      <div class="section-heading page-heading"><h2>Services</h2><button class="primary" id="addServiceButton" type="button" aria-controls="serviceForm" aria-expanded="false">Add service</button></div>
      <div class="panel"><div class="section-heading"><div><h3>Excel import and export</h3><p class="hint">Export all services, edit in Excel, then import. Keep Service IDs to update existing services. Leave the ID blank for new services; matching name, category and sub-category will update an existing entry.</p></div><div class="excel-actions"><a class="secondary button-link" href="/api/services/export">Export Excel</a><button class="primary" id="importServicesButton" type="button">Import Excel</button><input class="hidden" id="serviceImportFile" type="file" accept=".xlsx,.xls"></div></div><p id="serviceImportResult" role="status"></p></div><form class="panel service-editor hidden" id="serviceForm"><h2 id="serviceFormTitle">Add service</h2><input name="serviceId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Category<select name="category" id="serviceCategorySelect" required></select></label></div><label id="newServiceCategoryLabel" class="hidden">New category<input name="newCategory" placeholder="Enter a new category" disabled></label><div class="grid"><label>Sub-category<select name="subCategory" id="serviceSubCategorySelect" required></select></label><label>Duration minutes<input name="durationMinutes" type="number" min="1" step="1" required></label></div><div class="grid"><label>Price $<input name="price" type="number" min="0.01" step="0.01" required></label><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label></div><label id="newServiceSubCategoryLabel" class="hidden">New sub-category<input name="newSubCategory" placeholder="Enter a new sub-category" disabled></label><div class="form-actions"><button class="primary" id="serviceSaveButton" type="submit">Save service</button><button class="secondary" id="cancelServiceEdit" type="button">Cancel</button></div></form>
      <div class="panel product-table-panel"><div class="section-heading product-table-heading"><div><p class="eyebrow">Catalogue</p><h2>All services</h2><p class="hint" id="serviceCount" aria-live="polite"></p></div><div class="product-table-controls"><label class="product-search"><span>Search services</span><input id="serviceSearch" type="search" placeholder="Name, category, sub-category or status"></label><label><span>Category</span><select id="serviceCategoryFilter"><option value="">All categories</option></select></label><label><span>Sub-category</span><select id="serviceSubCategoryFilter"><option value="">All sub-categories</option></select></label><label><span>Status</span><select id="serviceStatusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label></div></div><div class="service-hierarchy" id="servicesHierarchy"></div></div>
    </section>
    <section class="tab admin-only" id="products">
      <div class="product-top-grid">
        <form class="panel product-editor" id="productForm"><div class="section-heading"><div><p class="eyebrow">Product details</p><h2 id="productFormTitle">Add product</h2></div><button class="secondary hidden" id="cancelProductEdit" type="button">Cancel edit</button></div><input name="productId" type="hidden"><div class="grid"><label>Name<input name="name" required></label><label>Brand<input name="brand"></label></div><div class="grid"><label>Category<input name="category" placeholder="Haircare" required></label><label>Sub-category / type<input name="subCategory" placeholder="Shampoo" required></label></div><div class="grid"><label>SKU — numbers only<input name="sku" inputmode="numeric" pattern="[0-9]*"></label><label>Barcode<input name="barcode"></label></div><div class="grid"><label>Status<select name="status"><option>Active</option><option>Inactive</option></select></label><label>Cost $<input name="cost" type="number" min="0" step="0.01" value="0.00"></label></div><div class="grid"><label>Retail price $<input name="price" type="number" min="0.01" step="0.01" required></label><label>Special price $<input name="specialPrice" type="number" min="0" step="0.01" placeholder="Leave blank when not discounted"></label></div><button class="primary full" id="productSaveButton" type="submit">Save product</button></form>
        <div class="panel product-excel-panel"><div class="excel-icon">${appIcon("products")}</div><p class="eyebrow">Excel tools</p><h2>Import or export products</h2><p class="hint">Export the current catalogue, edit it in Excel, then import it back. Existing products are matched by Product ID, SKU, or barcode.</p><div class="excel-actions"><a class="secondary button-link" href="/api/products/export">Export Excel</a><button class="primary" id="importProductsButton" type="button">Import Excel</button><input class="hidden" id="productImportFile" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"></div><p class="import-result" id="productImportResult"></p></div>
      </div>
      <div class="panel product-table-panel"><div class="section-heading product-table-heading"><div><p class="eyebrow">Catalogue</p><h2 id="productTableTitle">All products</h2><p class="hint" id="productCount" aria-live="polite"></p></div><div class="product-table-controls"><label><span>Branch</span><select id="productBranchFilter" aria-label="Filter product stock by branch"><option value="">All branches</option></select></label><label class="product-search"><span>Search</span><input id="productSearch" type="search" placeholder="Name, category, type, brand, SKU or barcode"></label><label><span>Category</span><select id="productCategoryFilter"><option value="">All categories</option></select></label><label><span>Sub-category</span><select id="productSubCategoryFilter"><option value="">All sub-categories</option></select></label><label><span>Brand</span><select id="productBrandFilter"><option value="">All brands</option></select></label><label><span>Status</span><select id="productStatusFilter"><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></label></div></div><div class="product-hierarchy" id="productsHierarchy"></div></div>
    </section>
    <section class="tab admin-only" id="inventory">
      <div class="split">
        <form class="panel" id="stockForm"><h2>Stock movement</h2><label>Branch<select name="branchId" required></select></label><label>Product<select name="productId" required></select></label><div class="grid"><label>Type<select name="movementType"><option>Receive</option><option>Adjustment in</option><option>Adjustment out</option><option>Transfer in</option><option>Transfer out</option></select></label><label>Quantity<input name="quantity" type="number" min="1" required></label></div><div class="grid"><label>Reference<input name="reference" placeholder="Invoice / transfer"></label><label>Reason<input name="reason" placeholder="Supplier delivery"></label></div><button class="primary full" type="submit">Save movement</button></form>
        <div class="panel"><h2>All product inventory by branch</h2><div class="table-wrap"><table><thead id="inventoryHead"></thead><tbody id="inventoryTable"></tbody></table></div></div>
      </div>
    </section>
    <section class="tab staff-only" id="closing">
      <div class="closing-layout">
        <form class="panel" id="closingForm">
          <div class="section-heading"><div><h2>Daily closing</h2><p class="hint" id="closingDateTitle"></p></div><label>Date<input name="closingDate" type="date" required></label></div>
          <input name="branchId" type="hidden">
          <div class="drawer-closing-control"><div><strong>Cash drawer</strong><p class="hint">Open the drawer before counting. Daily closing does not require a reason.</p></div><button class="secondary" id="closingOpenCashDrawer" type="button">Open cash drawer</button><p class="hint" id="closingCashDrawerStatus" role="status"></p></div>
          <div class="table-wrap" id="closingExpected"></div>
          <fieldset class="cash-counter"><legend>Count cash in the drawer</legend><div class="denomination-grid">
            <label>$100<input aria-label="$100 count" data-denomination="100" type="number" min="0" max="100000" step="1" value="0" required></label>
            <label>$50<input aria-label="$50 count" data-denomination="50" type="number" min="0" max="100000" step="1" value="0" required></label>
            <label>$20<input aria-label="$20 count" data-denomination="20" type="number" min="0" max="100000" step="1" value="0" required></label>
            <label>$10<input aria-label="$10 count" data-denomination="10" type="number" min="0" max="100000" step="1" value="0" required></label>
            <label>$5<input aria-label="$5 count" data-denomination="5" type="number" min="0" max="100000" step="1" value="0" required></label>
            <label>$2<input aria-label="$2 count" data-denomination="2" type="number" min="0" max="100000" step="1" value="0" required></label>
            <label>$1<input aria-label="$1 count" data-denomination="1" type="number" min="0" max="100000" step="1" value="0" required></label>
          </div></fieldset>
          <div class="closing-fields">
            <label>Previous float $<input name="previousCash" type="number" readonly></label>
            <label>Extra opening float $<input name="openingFloat" type="number" min="0" step="0.01" placeholder="0.00"></label>
            <label>Cash counted $<input name="actualCash" type="number" readonly></label>
            <label>Cash Taken $<input name="cashTaken" type="number" min="0" step="0.01" placeholder="0.00"></label>
            <label>Float end $<input name="remainingCash" type="number" readonly></label>
            <label>Card terminal total $<input name="actualCard" type="number" min="0" step="0.01" placeholder="0.00"></label>
          </div>
          <div class="closing-summary" id="closingVariance"></div>
          <details><summary>Notes (optional)</summary><label>Notes<textarea name="notes" rows="2"></textarea></label></details>
          <p class="hint">Confirm with your staff PIN to record who closed the day.</p>
          <button class="primary" type="submit">Close register</button>
        </form>
        <div class="panel"><div class="section-heading"><h2>Sales for this day</h2><span class="pill" id="closingSalesCount"></span></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Sale</th><th>Payment</th><th>Total</th><th>Completed by</th><th>Edit</th></tr></thead><tbody id="closingSalesTable"></tbody></table></div><p class="hint">Editing a sale requires a manager PIN and a reason. Both are recorded in the edit history.</p></div>
        <details class="panel" open><summary>Cash drawer opening history</summary><div class="table-wrap"><table><thead><tr><th>Date and time</th><th>Opened by</th><th>Source</th><th>Reason</th></tr></thead><tbody id="cashDrawerHistoryTable"></tbody></table></div></details>
        <details class="panel"><summary>Previous closing records</summary><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Cash taken</th><th>Remaining cash</th><th>Status</th></tr></thead><tbody id="closingTable"></tbody></table></div></details>
      </div>
    </section>
    <section class="tab admin-only" id="reports">
      <div class="panel report-filter-panel"><div><p class="eyebrow">Performance centre</p><h2>Business reports</h2><p class="hint">Filter once, then export any section.</p></div><div class="report-filters"><label>From<input id="reportFrom" type="date"></label><label>To<input id="reportTo" type="date"></label><label>Branch<select id="reportBranch"><option value="">All branches</option></select></label><button class="primary" id="applyReportFilters" type="button">Apply</button></div></div>
      <div class="metrics report-summary" id="reportMetrics"></div>
      <div class="panel report-section"><div class="section-heading"><div><h2>Staff sales by date</h2><p class="hint">Daily credited sales for each staff member at each branch. Shared services use the recorded staff allocation.</p></div><a class="secondary button-link report-export" data-report-type="staff-daily">Export Excel</a></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Staff</th><th>Role</th><th>Branch</th><th>Credited sales</th><th>Services credited</th><th>Transactions</th></tr></thead><tbody id="reportStaffDailyTable"></tbody></table></div></div>
      <div class="panel report-section"><div class="section-heading"><div><h2>Manager sales by date</h2><p class="hint">Daily branch sales for each manager rostered there. If managers share a branch on the same day, each receives that branch total.</p></div><a class="secondary button-link report-export" data-report-type="manager-daily">Export Excel</a></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Manager</th><th>Branch</th><th>Managed store sales</th><th>Transactions</th></tr></thead><tbody id="reportManagerDailyTable"></tbody></table></div></div>
      <div class="panel report-section"><div class="section-heading"><div><h2>Branch sales by date</h2><p class="hint">Daily sales and transaction totals for each branch in the selected period.</p></div><a class="secondary button-link report-export" data-report-type="branch-daily">Export Excel</a></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Total sales</th><th>Transactions</th><th>Products</th><th>Services</th></tr></thead><tbody id="reportBranchDailyTable"></tbody></table></div></div>
      <div class="panel report-section"><div class="section-heading"><div><h2>Sales by branch</h2><p class="hint">Store sales, transactions, product and service volume, bookings and walk-ins.</p></div><a class="secondary button-link report-export" data-report-type="branch">Export Excel</a></div><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Total sales</th><th>Transactions</th><th>Products</th><th>Services</th><th>Online</th><th>Manual</th><th>Walk-ins</th></tr></thead><tbody id="reportBranchTable"></tbody></table></div></div>
      <div class="panel report-section"><div class="section-heading"><div><h2>Staff and manager sales</h2><p class="hint">Staff credited sales; manager store sales add the branch totals for each day they were rostered there.</p></div><a class="secondary button-link report-export" data-report-type="staff">Export Excel</a></div><div class="table-wrap"><table><thead><tr><th>Staff</th><th>Role</th><th>Credited sales</th><th>Services sold</th><th>Managed store sales</th></tr></thead><tbody id="reportStaffTable"></tbody></table></div></div>
      <div class="report-two-column"><div class="panel report-section"><div class="section-heading"><div><h2>Products sold</h2></div><a class="secondary button-link report-export" data-report-type="products">Export</a></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Sales</th></tr></thead><tbody id="reportProductsTable"></tbody></table></div></div><div class="panel report-section"><div class="section-heading"><div><h2>Services sold</h2></div><a class="secondary button-link report-export" data-report-type="services">Export</a></div><div class="table-wrap"><table><thead><tr><th>Service</th><th>Qty</th><th>Sales</th></tr></thead><tbody id="reportServicesTable"></tbody></table></div></div></div>
      <div class="panel report-section"><div class="section-heading"><div><h2>Bookings and walk-ins</h2><p class="hint">Online bookings, branch-created manual bookings, and POS visits without a booking.</p></div><a class="secondary button-link report-export" data-report-type="bookings">Export Excel</a></div><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Source</th><th>Bookings / visits</th><th>Value</th><th>Completed</th></tr></thead><tbody id="reportBookingsTable"></tbody></table></div></div>
      <div class="panel report-section payroll-report"><div class="section-heading"><div><h2>Clock-in/out and payroll hours</h2><p class="hint">Actual completed time entries calculate net hours, excluding recorded breaks.</p></div><div class="report-export-actions"><a class="secondary button-link report-export" data-report-type="payroll">Export Excel</a><a class="primary button-link report-export" data-report-type="xero">Export Xero CSV</a></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Staff</th><th>Branch</th><th>Clock in</th><th>Break</th><th>Clock out</th><th>Net hours</th><th>Status</th></tr></thead><tbody id="reportPayrollTable"></tbody></table></div></div>
      <div class="panel"><h2>Admin closing review</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Actual cash</th><th>Cash taken</th><th>Actual card</th><th>Status</th><th>Approved by</th><th></th></tr></thead><tbody id="adminClosingTable"></tbody></table></div></div>
    </section>
    <section class="tab admin-only" id="branches">
      <div class="panel"><div class="section-heading"><div><p class="eyebrow">Locations</p><h2>Branches</h2><p class="hint">Manage your locations, opening hours and holidays.</p></div><button class="primary" id="createBranchButton" type="button">Create branch</button></div><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Address</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead><tbody id="branchTable"></tbody></table></div></div>
      <details class="panel branch-archive"><summary>Archived branches <span id="branchArchiveCount" class="pill">0</span></summary><p class="hint">All records are retained. Restore a branch here, or permanently erase it.</p><div class="table-wrap"><table><thead><tr><th>Branch</th><th>Address</th><th>Actions</th></tr></thead><tbody id="branchArchiveTable"></tbody></table></div></details>
      <dialog id="branchEditor" class="branch-dialog" aria-labelledby="branchEditorTitle">
        <form id="branchForm">
          <div class="branch-dialog-header"><div><p class="eyebrow">Branch settings</p><h2 id="branchEditorTitle">Create branch</h2><p class="hint">Keep details, hours and holidays in one place.</p></div><button class="secondary branch-icon-button" id="closeBranchEditor" type="button" aria-label="Close branch editor">✕</button></div>
          <div class="branch-dialog-body"><section class="branch-form-section"><h3>Branch details</h3><p class="hint">The information your team uses to identify this location.</p><input name="id" type="hidden"><label>Branch name<input name="name" required></label><label>Address<input name="address" required></label><div class="grid"><label>Phone<input name="phone" required></label><label>Postcode / PIN<input name="postCode" inputmode="numeric"></label></div><label>Status<select name="status"><option>Open</option><option>Closed</option></select></label></section>
          <section class="branch-form-section"><div class="section-heading"><div><h3>Weekly timetable</h3><p class="hint">Set regular opening hours, or mark a day as closed.</p></div><button type="button" class="secondary small" id="copyBranchHours">Copy Monday to weekdays</button></div><div class="table-wrap"><table class="branch-hours-table"><thead><tr><th>Day</th><th>Open</th><th>Close</th><th>Closed</th></tr></thead><tbody id="branchHoursEditor"></tbody></table></div></section>
          <section class="branch-form-section"><div class="section-heading"><div><h3>Closed dates</h3><p class="hint">Add public holidays and one-off closures.</p></div><button class="secondary" id="addBranchClosedDate" type="button">Add closed date</button></div><div id="branchClosedDatesEditor"></div></section></div>
          <div class="branch-dialog-footer"><p id="branchEditorMessage" role="alert"></p><div class="section-heading"><button class="secondary" id="cancelBranchEditor" type="button">Cancel</button><button class="primary" id="saveBranchButton" type="submit">Create branch</button></div></div>
        </form>
      </dialog>
      <dialog id="branchActionDialog" class="branch-dialog branch-action-dialog" aria-labelledby="branchActionTitle">
        <form id="branchActionForm"><div class="branch-dialog-header"><div><p class="eyebrow">Confirm branch action</p><h2 id="branchActionTitle"></h2></div></div><div class="branch-dialog-body"><input name="branchId" type="hidden"><input name="mode" type="hidden"><div class="branch-action-warning" id="branchActionWarning"></div><label id="branchActionNameLabel" hidden>Type the branch name to confirm<input name="confirmName" autocomplete="off"></label><label>Admin PIN<input name="pin" type="password" inputmode="numeric" autocomplete="off" required placeholder="Enter PIN"></label><p class="hint">The separate admin PIN is required. Branch login PINs cannot approve this action.</p><p id="branchActionError" role="alert"></p></div><div class="branch-dialog-footer"><div class="section-heading"><button type="button" class="secondary" id="cancelBranchAction">Cancel</button><button type="submit" class="danger" id="confirmBranchAction"></button></div></div></form>
      </dialog>
    </section>
    <section class="tab admin-only" id="access">${accessPanelHtml()}
    </section>
  </main>
  <script>window.currentUser = ${JSON.stringify(publicIdentity(accessUser)).replace(/</g, "\\u003c")}; window.initialBranchId = ${JSON.stringify(initialBranchId)}; window.appMode = ${JSON.stringify(mode)}; window.uiIconPaths = ${JSON.stringify(UI_ICON_PATHS)}; ${clientScript()}</script>
</body>
</html>`;
}

function clientScript() {
  return `
let state = { branches: [], staff: [], services: [], serviceCategoryOrder: [], products: [], productCategoryOrder: [], customers: [], bookings: [], sales: [], saleItems: [], branchHours: [], closedDates: [], discounts: [], inventoryStock: [], stockMovements: [], dailyClosings: [], cashDrawerOpens: [], staffRoster: [], staffRegularDaysOff: [], timeEntries: [] };
let reportData = null;
let reportRequestId = 0;
let lastReceipt = null;
try { lastReceipt = JSON.parse(sessionStorage.getItem("kunchasLastReceipt") || "null"); } catch {}
let salePayments = [];
let paymentTotalSnapshot = 0;
let closingSalesKey = '';
let closingSalesLoading = false;
let closingSalesRequest = 0;
let checkoutBookingRequest = 0;
let checkoutBookingTimer;
let recentSales = [];
let recentSalesRequest = 0;
let recentSalesLoading = false;
let selectedPosBranchId = "";
let selectedPosPin = "";
let draggedStaffId = "";
let selectedDashboardPeriod = "today";
let selectedGlobalBranchId = window.currentUser.managerBranchId || "";
let selectedRosterBranchId = "";
let selectedProductBranchId = "";
let draggedServiceCategory = "";
let draggedProductCategory = "";
let draggedProductId = "";
const expandedServiceCategories = new Set();
const expandedServiceSubCategories = new Set();
const expandedProductCategories = new Set();
const expandedProductSubCategories = new Set();
const appMode = window.appMode || "admin";
const message = document.querySelector("#message");
${accessClientScript()}
${posPinScript()}
document.querySelectorAll(".nav[data-tab]").forEach((button) => button.addEventListener("click", () => {
  showTab(button.dataset.tab);
}));
document.querySelector("#loadData").addEventListener("click", loadData);
document.querySelector("#openPos").addEventListener("click", openPos);
document.querySelector("#switchBranch").addEventListener("click", switchBranch);
document.querySelector("#posPin").addEventListener("keydown", event => { if(event.key === "Enter") { event.preventDefault(); document.querySelector("#openPos").click(); } });
document.querySelector('#recentSalesDate').addEventListener('change',loadRecentSales);
document.querySelector('#recentSalesSearch').addEventListener('input',renderSales);
document.querySelector('#recentSalesToday').addEventListener('click',()=>{document.querySelector('#recentSalesDate').value=localSalesDate();loadRecentSales();});
document.querySelector("#managerDashboardButton")?.addEventListener("click", openManagerDashboard);
document.querySelector("#cancelManagerDashboard")?.addEventListener("click", () => document.querySelector("#managerDashboardDialog").close());
document.querySelector("#managerDashboardForm")?.addEventListener("submit", submitManagerDashboard);
document.querySelector("#clockInButton").addEventListener("click", () => submitTimeClock("clock-in"));
document.querySelector("#breakStartButton").addEventListener("click", () => submitTimeClock("break-start"));
document.querySelector("#breakEndButton").addEventListener("click", () => submitTimeClock("break-end"));
document.querySelector("#clockOutButton").addEventListener("click", () => submitTimeClock("clock-out"));
document.querySelector("#timeClockStaff").addEventListener("change", renderTimeClockStatus);
document.querySelector("#addSaleItem").addEventListener("click", () => addSaleItem());
document.querySelector("#bookingCheckout").addEventListener("change", selectBookingForCheckout);
document.querySelector("#bookingCheckoutSearch").addEventListener("input", () => { clearTimeout(checkoutBookingTimer); checkoutBookingRequest++; checkoutBookingTimer = setTimeout(renderBookingCheckoutOptions, 250); });
document.querySelector("#showPaymentMethods").addEventListener("click", showPaymentMethods);
document.querySelectorAll("[data-payment-method]").forEach((button) => button.addEventListener("click", () => addPayment(button.dataset.paymentMethod)));
document.querySelector("#printLastReceiptButton").addEventListener("click", printLastReceipt);
document.querySelector("#checkoutPrintReceipt").addEventListener("click", () => { printLastReceipt(); document.querySelector("#checkoutCompleteDialog").close("printed"); });
document.querySelector("#openCashDrawer").addEventListener("click", () => openCashDrawer("checkout"));
document.querySelector("#closingOpenCashDrawer").addEventListener("click", () => openCashDrawer("daily_closing"));
document.querySelector("#checkoutCompleteDialog").addEventListener("close", clearCheckoutReceiptPrompt);
document.querySelector("#customerForm").addEventListener("submit", submitCustomer);
document.querySelector("#customerProfileForm").addEventListener("submit", submitCustomerProfile);
document.querySelector("#closeCustomerProfile").addEventListener("click", closeCustomerProfile);
document.querySelector("#bookingForm").addEventListener("submit", submitBooking);
document.querySelector("#bookingServiceSearch").addEventListener("click", toggleBookingServiceMenu);
document.querySelector("#bookingDisplayDate").addEventListener("change", renderBookings);
document.querySelector("#bookingToday").addEventListener("click", () => moveBookingDiaryTo(new Date()));
document.querySelector("#bookingPreviousDay").addEventListener("click", () => moveBookingDiaryBy(-1));
document.querySelector("#bookingNextDay").addEventListener("click", () => moveBookingDiaryBy(1));
document.querySelector("#saleForm").addEventListener("submit", submitSale);
document.querySelector('select[name="customerMode"]').addEventListener("change", updateCustomerMode);
document.querySelector('#closingForm input[name="closingDate"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="openingFloat"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="actualCash"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="cashTaken"]').addEventListener("input", renderClosingPreview);
document.querySelector('#closingForm input[name="actualCard"]').addEventListener("input", renderClosingPreview);
document.querySelector("#staffForm").addEventListener("submit", submitStaffForm);
document.querySelector("#addStaffButton").addEventListener("click", () => {
  if (!userCan("staff", true) || !currentUser.allBranches) return;
  const form = document.querySelector("#staffForm");
  form.hidden = false;
  document.querySelector("#addStaffButton").setAttribute("aria-expanded", "true");
  closeStaffProfile();
  form.scrollIntoView({ behavior:"smooth", block:"start" });
  form.elements.name.focus({ preventScroll:true });
});
document.querySelector("#cancelStaffAdd").addEventListener("click", () => {
  const form = document.querySelector("#staffForm");
  form.reset(); form.elements.staffId.value = ""; renderStaffLogin(form);
  closeStaffAdd(); document.querySelector("#addStaffButton").focus();
});
document.querySelector("#staffSearch").addEventListener("input", renderStaff);
document.querySelector("#staffStatusFilter").addEventListener("change", renderStaff);
document.addEventListener("click", (event) => {
  const menu = document.querySelector("#accountDropdown");
  if (menu && (!menu.contains(event.target) || event.target.closest("button"))) menu.open = false;
});
document.addEventListener("keydown", (event) => {
  const menu = document.querySelector("#accountDropdown");
  if (event.key === "Escape" && menu?.open) { menu.open = false; menu.querySelector("summary").focus(); }
});
function closeStaffAdd() {
  document.querySelector("#staffForm").hidden = true;
  document.querySelector("#addStaffButton").setAttribute("aria-expanded", "false");
}
syncLastReceiptButton();
document.querySelector("#staffProfileForm").addEventListener("submit", submitStaffProfile);
document.querySelector("#closeStaffProfile").addEventListener("click", closeStaffProfile);
document.querySelector("#rosterMonth").addEventListener("change", renderRosterMonthCalendar);
document.querySelector("#rosterDay").addEventListener("change", () => { renderRosterMonthCalendar(); renderRosterBranchBoard(); });
document.querySelector("#rosterBranchSelect").addEventListener("change", (event) => { selectedRosterBranchId = event.currentTarget.value; renderRosterMonthCalendar(); renderRosterBranchBoard(); });
document.querySelector("#globalBranchFilter")?.addEventListener("change", (event) => { selectedGlobalBranchId = event.currentTarget.value; renderMetrics(); });
document.querySelectorAll(".period-tab").forEach((button) => button.addEventListener("click", () => { selectedDashboardPeriod = button.dataset.period; document.querySelectorAll(".period-tab").forEach((item) => item.classList.toggle("active", item === button)); renderMetrics(); }));
document.querySelector("#copyBranchHours").addEventListener("click", () => {
  const rows = document.querySelectorAll("#branchHoursEditor tr"), first = rows[0];
  for (let i = 1; i < 5; i++) {
    for (const selector of [".branch-open", ".branch-close"]) rows[i].querySelector(selector).value = first.querySelector(selector).value;
    rows[i].querySelector(".branch-closed").checked = first.querySelector(".branch-closed").checked;
    rows[i].querySelector(".branch-closed").dispatchEvent(new Event("change"));
  }
});
document.querySelector("#branchActionForm").addEventListener("submit", submitBranchAction);
document.querySelector("#cancelBranchAction").addEventListener("click", () => document.querySelector("#branchActionDialog").close());
document.querySelector("#branchActionDialog").addEventListener("close", () => document.querySelector("#branchActionForm").reset());
document.querySelector("#branchForm").addEventListener("submit", submitBranchForm);
document.querySelector("#createBranchButton").addEventListener("click", () => openBranchEditor());
document.querySelector("#closeBranchEditor").addEventListener("click", () => document.querySelector("#branchEditor").close());
document.querySelector("#cancelBranchEditor").addEventListener("click", () => document.querySelector("#branchEditor").close());
document.querySelector("#addBranchClosedDate").addEventListener("click", () => addBranchClosedDate());
document.querySelector("#serviceForm").addEventListener("submit", submitServiceForm);
document.querySelector("#addServiceButton").addEventListener("click", () => { resetServiceForm(); openServiceForm(); });
document.querySelector("#cancelServiceEdit").addEventListener("click", resetServiceForm);
document.querySelector("#serviceSearch").addEventListener("input", renderServices);
["#serviceCategoryFilter", "#serviceSubCategoryFilter", "#serviceStatusFilter"].forEach((selector) => document.querySelector(selector).addEventListener("change", renderServices));
document.querySelector("#serviceCategorySelect").addEventListener("change", () => {
  toggleNewServiceValue("category", true);
  refreshServiceSubCategories();
});
document.querySelector("#serviceSubCategorySelect").addEventListener("change", () => toggleNewServiceValue("subCategory", true));
document.querySelector('#serviceForm [name="newCategory"]').addEventListener("change", () => refreshServiceSubCategories());
document.querySelector("#productForm").addEventListener("submit", submitProductForm);
document.querySelector("#cancelProductEdit").addEventListener("click", resetProductForm);
document.querySelector("#productSearch").addEventListener("input", renderProducts);
["#productCategoryFilter", "#productSubCategoryFilter", "#productBrandFilter", "#productStatusFilter"].forEach((selector) => document.querySelector(selector).addEventListener("change", renderProducts));
document.querySelector("#productBranchFilter").addEventListener("change", (event) => { selectedProductBranchId = event.currentTarget.value; renderProducts(); });
document.querySelector("#importServicesButton").addEventListener("click",()=>document.querySelector("#serviceImportFile").click());
document.querySelector("#serviceImportFile").addEventListener("change",importServicesWorkbook);
document.querySelector("#importProductsButton").addEventListener("click", () => document.querySelector("#productImportFile").click());
document.querySelector("#productImportFile").addEventListener("change", importProductsWorkbook);
document.querySelector("#stockForm").addEventListener("submit", (event) => submitAdminForm(event, "/api/stock-movements"));
document.querySelector("#receiveProductsForm").addEventListener("submit", submitReceivedProducts);
document.querySelector("#closingForm").addEventListener("submit", submitCountedClosing);


document.querySelector("#applyReportFilters").addEventListener("click", loadReports);
document.querySelector("#reportBranch").addEventListener("change", loadReports);
addSaleItem();
updateCustomerMode();
loadPublicBranches();
setInitialRosterWeek();
setInitialReportRange();
applyAccessUi();
if (appMode === "admin") loadData();

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (appMode === "staff") headers["x-pos-workspace"] = "1";
  else if (currentUser.managerBranchId) headers["x-branch-id"] = currentUser.managerBranchId;
  if (selectedPosBranchId && (path.startsWith("/api/checkout-bookings") || path === "/api/pos-data" || path === "/api/sales" || path === "/api/stock-movements" || path === "/api/branch-bookings" || path === "/api/daily-closing" || path === "/api/time-clock" || path.startsWith("/api/bookings/") || path.startsWith("/api/sales/") || path.startsWith("/api/daily-closing/"))) {
    headers["x-branch-id"] = selectedPosBranchId;

  }
  if (options.body) headers["content-type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  const result = await response.json();
  if (response.status === 401) { if(appMode!=="admin") throw new Error("Open the branch with its PIN again."); location.href="/login"; throw new Error("Please sign in again."); }
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
function openManagerDashboard() {
  if (!selectedPosBranchId) { message.textContent = "Open a branch workspace before opening its manager dashboard."; return; }
  const form = document.querySelector("#managerDashboardForm");
  form.reset();
  document.querySelector("#managerDashboardError").textContent = "";
  document.querySelector("#managerDashboardDialog").showModal();
  form.elements.pin.focus();
}
async function submitManagerDashboard(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  document.querySelector("#managerDashboardError").textContent = "";
  try {
    await api("/api/auth/manager-dashboard", { method:"POST", body:JSON.stringify({ branchId:selectedPosBranchId, pin:form.elements.pin.value }) });
    location.href = "/manager";
  } catch (error) {
    document.querySelector("#managerDashboardError").textContent = error.message;
    form.elements.pin.value = "";
    form.elements.pin.focus();
  } finally {
    button.disabled = false;
  }
}
async function openPos() {
  const button = document.querySelector("#openPos");
  if (button.disabled) return;
  selectedPosBranchId = document.querySelector("#posBranch").value;
  document.querySelector("#bookingCheckoutSearch").value = "";
  checkoutBookingRequest++;
  selectedPosPin = document.querySelector("#posPin").value;
  if (!selectedPosBranchId) {
    message.textContent = "Select a branch.";
    return;
  }
  if (!selectedPosPin.trim()) { message.textContent = "Enter your branch login PIN."; return; }
  button.disabled = true;
  try {
  await api("/api/pos-login",{method:"POST",body:JSON.stringify({branchId:selectedPosBranchId,pin:selectedPosPin})});
  if(!await refreshPosData())return;
  const branch = state.branches[0];
  document.querySelector("#posBranchName").textContent = branch ? branch.name : "Branch POS";
  document.querySelector("#appTitle").textContent = branch ? branch.name : "Kunchas branch";
  document.querySelector('#saleForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#bookingForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#closingForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#receiveProductsForm input[name="branchId"]').value = selectedPosBranchId;
  document.querySelector('#closingForm input[name="closingDate"]').value ||= new Date().toISOString().slice(0, 10);
  renderClosingPreview();
  document.querySelector("#posLogin").classList.add("hidden");
  document.querySelector("#posWorkspace").classList.remove("hidden");
  document.querySelector("#receiveWorkspace").classList.remove("hidden");
  document.querySelector("#staffWorkspace").classList.remove("hidden");
  document.body.classList.remove("pos-locked");
  } catch(error) { message.textContent = error.message; }
  finally { selectedPosPin = ""; document.querySelector("#posPin").value = ""; button.disabled = false; }
}
async function switchBranch() {
  try {
  await api("/api/pos-logout",{method:"POST"});
  document.body.classList.add("pos-locked");
  location.assign("/pos");
  } catch(error) { message.textContent = error.message; }
}
async function refreshPosData() {
  try {
    message.textContent = "Opening branch workspace...";
    state = normalizeState(await api("/api/pos-data"));
    closingSalesKey = '';
    if (document.querySelector('#recent-sales').classList.contains('active')) loadRecentSales();
    renderAll();
    document.querySelector('#saleForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#bookingForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#closingForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#receiveProductsForm input[name="branchId"]').value = selectedPosBranchId;
    document.querySelector('#closingForm input[name="closingDate"]').value ||= new Date().toISOString().slice(0, 10);
    renderClosingPreview();
    message.textContent = "Workspace opened for " + (state.branch?.name || state.branches[0]?.name || "selected branch") + ".";
    return true;
  } catch (error) {
    message.textContent = error.message; return false;
  }
}
function renderTimeClockStatus() {
  const select = document.querySelector("#timeClockStaff");
  const status = document.querySelector("#timeClockStatus");
  if (!select || !status) return;
  const open = (state.timeEntries || []).find((entry) => entry.staff_id === select.value && !entry.clock_out);
  status.textContent = open?.break_started_at ? "On break since " + new Date(open.break_started_at).toLocaleTimeString("en-AU", { hour:"numeric", minute:"2-digit" }) : open ? "Clocked in since " + new Date(open.clock_in).toLocaleTimeString("en-AU", { hour:"numeric", minute:"2-digit" }) : "Actual hours feed the payroll report.";
}
function renderClockedInStaff() {
  const table = document.querySelector("#clockedInStaffTable");
  const count = document.querySelector("#clockedInCount");
  if (!table || !count) return;
  const entries = (state.timeEntries || []).filter((entry) => !entry.clock_out);
  count.textContent = entries.length + " clocked in";
  table.innerHTML = entries.length ? entries.map((entry) => {
    const status = entry.break_started_at ? "On break" : "Working";
    return '<tr><td><strong>' + esc(entry.staff_name || "Staff") + '</strong></td><td>' + esc(new Date(entry.clock_in).toLocaleTimeString("en-AU", { hour:"numeric", minute:"2-digit" })) + '</td><td><span class="pill">' + status + '</span></td><td>' + Number(entry.break_minutes || 0) + '</td></tr>';
  }).join("") : '<tr><td colspan="4" class="empty-cell">No staff are clocked in at this branch.</td></tr>';
}
async function submitTimeClock(action) {
  const staffId = document.querySelector("#timeClockStaff").value;
  if (!staffId) { message.textContent = "Choose a staff member first."; return; }
  try {
    message.textContent = action === "clock-in" ? "Clocking in..." : "Clocking out...";
    const actor=await askActor(selectedPosBranchId,false,"Confirm time clock with your PIN");if(!actor)return;
    const result = await api("/api/time-clock", { method:"POST", body:JSON.stringify({ ...actor, staffId, action }) });
    await refreshPosData();
    document.querySelector("#timeClockStaff").value = staffId;
    renderTimeClockStatus();
    message.textContent = result.status + ".";
  } catch (error) { message.textContent = error.message; }
}
function normalizeState(data = {}) {
  const arrayKeys = ["branches","staff","services","serviceCategoryOrder","products","productCategoryOrder","customers","bookings","sales","saleItems","branchHours","closedDates","discounts","inventoryStock","stockMovements","dailyClosings","cashDrawerOpens","staffRoster","staffRegularDaysOff","timeEntries"];
  const normalized = { ...data };
  arrayKeys.forEach((key) => { if (!Array.isArray(normalized[key])) normalized[key] = []; });
  normalized.archivedBranches = normalized.branches.filter((b) => b.status === "Archived");
  normalized.branches = normalized.branches.filter((b) => b.status !== "Archived");
  return normalized;
}
function renderAll() { fillSelects(); if (currentUser.managerBranchId) document.querySelector("#appTitle").textContent = (state.branches[0]?.name || "Branch") + " · Manager Dashboard"; renderMetrics(); renderBranches(); renderStaff(); renderServices(); renderProducts(); renderCustomers(); renderBookings(); renderSales(); renderInventory(); renderReceivedProducts(); renderClosings(); loadReports(); renderRosterMonthCalendar(); renderRosterBranchBoard(); renderAccess(); renderClosingPreview(); renderTimeClockStatus(); renderClockedInStaff(); applyAccessUi(); }
function fillSelects() {
  const branchOptions = state.branches.map((b) => '<option value="' + b.id + '">' + esc(b.name) + '</option>').join("");
  const staffSelectOptions = '<option value="">Unassigned</option>' + state.staff.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join("");
  const customerOptions = '<option value="">Walk-in</option>' + state.customers.map((c) => '<option value="' + c.id + '">' + esc(c.first_name + " " + c.last_name) + '</option>').join("");
  const productOptions = '<option value="">Select product</option>' + (state.products || []).map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' - ' + money(Number(p.special_price_cents || 0) > 0 ? p.special_price_cents : p.price_cents) + '</option>').join("");
  const globalBranch = document.querySelector("#globalBranchFilter");
  if (globalBranch) {
    globalBranch.innerHTML = (currentUser.managerBranchId ? '' : '<option value="">All branches</option>') + branchOptions;
    globalBranch.disabled = Boolean(currentUser.managerBranchId);
    if (state.branches.some((branch) => branch.id === selectedGlobalBranchId)) globalBranch.value = selectedGlobalBranchId;
    else selectedGlobalBranchId = "";
  }
  const rosterBranch = document.querySelector("#rosterBranchSelect");
  if (rosterBranch) {
    rosterBranch.innerHTML = branchOptions;
    if (!state.branches.some((branch) => branch.id === selectedRosterBranchId)) selectedRosterBranchId = state.branches[0]?.id || "";
    rosterBranch.value = selectedRosterBranchId;
  }
  const productBranch = document.querySelector("#productBranchFilter");
  if (productBranch) {
    productBranch.innerHTML = (currentUser.managerBranchId ? '' : '<option value="">All branches</option>') + branchOptions;
    if (!state.branches.some((branch) => branch.id === selectedProductBranchId)) selectedProductBranchId = "";
    productBranch.value = selectedProductBranchId;
  }
  const reportBranch = document.querySelector("#reportBranch");
  if (reportBranch) {
    const current = reportBranch.value;
    reportBranch.innerHTML = (currentUser.managerBranchId ? '' : '<option value="">All branches</option>') + branchOptions;
    if (state.branches.some((branch) => branch.id === current)) reportBranch.value = current;
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
  document.querySelector("#itemList").innerHTML = "";
  document.querySelector("#staffList").innerHTML = state.staff.map((s) => '<option value="' + esc(staffLabel(s)) + '"></option>').join("");
  renderBookingCheckoutOptions();
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
  document.querySelector("#branchTable").innerHTML = state.branches.map((b) => '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc(b.address) + '</td><td>' + esc(b.phone) + '</td><td><span class="pill">' + esc(b.status) + '</span></td><td><a class="secondary button-link" href="/pos/' + encodeURIComponent(b.id) + '">POS</a> <button class="secondary branch-icon-button edit-branch" data-branch-id="' + esc(b.id) + '" type="button" aria-label="Edit ' + esc(b.name) + '" title="Edit branch">✎</button> <button class="danger branch-icon-button delete-branch" data-branch-id="' + esc(b.id) + '" type="button" aria-label="Archive branch" title="Archive branch">' + branchTrashIcon() + '</button></td></tr>').join("") || '<tr><td colspan="5" class="empty-cell">No branches yet. Create your first branch.</td></tr>';
  const archived = state.archivedBranches || [];
  document.querySelector("#branchArchiveCount").textContent = archived.length;
  document.querySelector("#branchArchiveTable").innerHTML = archived.map((b) => '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc(b.address) + '</td><td><button class="secondary small restore-branch" type="button" data-branch-id="' + esc(b.id) + '">Restore</button> <button class="danger branch-icon-button purge-branch" type="button" data-branch-id="' + esc(b.id) + '" aria-label="Permanently delete branch" title="Permanently delete">' + branchTrashIcon() + '</button></td></tr>').join("") || '<tr><td colspan="3" class="empty-cell">No archived branches.</td></tr>';
  document.querySelectorAll(".restore-branch").forEach((button) => button.addEventListener("click", () => openBranchAction(button.dataset.branchId, "restore")));
  document.querySelectorAll(".purge-branch").forEach((button) => button.addEventListener("click", () => openBranchAction(button.dataset.branchId, "permanent")));
  document.querySelectorAll(".edit-branch").forEach((button) => button.addEventListener("click", () => openBranchEditor(button.dataset.branchId)));
  document.querySelectorAll(".delete-branch").forEach((button) => button.addEventListener("click", deleteBranch));
}
function openBranchEditor(branchId = "") {
  const branch = state.branches.find((b) => b.id === branchId);
  const form = document.querySelector("#branchForm");
  form.reset();
  form.elements.id.value = branchId;
  for (const key of ["name", "address", "phone", "status"]) form.elements[key].value = branch?.[key] || (key === "status" ? "Open" : "");
  form.elements.postCode.value = branch?.post_code || "";
  document.querySelector("#branchEditorTitle").textContent = branch ? "Edit branch" : "Create branch";
  document.querySelector("#saveBranchButton").textContent = branch ? "Save branch" : "Create branch";
  document.querySelector("#branchEditorMessage").textContent = "";
  document.querySelector("#branchHoursEditor").innerHTML = [1,2,3,4,5,6,0].map((day) => {
    const hour = state.branchHours.find((h) => h.branch_id === branchId && Number(h.day_of_week) === day);
    return '<tr data-day="' + day + '"><td>' + dayName(day) + '</td><td><input aria-label="' + dayName(day) + ' opening time" class="branch-open" type="time" required value="' + esc(hour?.open_time || '09:00') + '"></td><td><input aria-label="' + dayName(day) + ' closing time" class="branch-close" type="time" required value="' + esc(hour?.close_time || '17:30') + '"></td><td><input aria-label="' + dayName(day) + ' closed" class="branch-closed" type="checkbox"' + (hour?.is_closed ? ' checked' : '') + '></td></tr>';
  }).join("");
  document.querySelectorAll("#branchHoursEditor tr").forEach((row) => {
    const toggle = () => row.querySelectorAll('input[type="time"]').forEach((input) => { input.disabled = row.querySelector(".branch-closed").checked; });
    row.querySelector(".branch-closed").addEventListener("change", toggle); toggle();
  });
  document.querySelector("#branchClosedDatesEditor").replaceChildren();
  state.closedDates.filter((d) => d.branch_id === branchId).forEach(addBranchClosedDate);
  document.querySelector("#branchEditor").showModal();
}
function addBranchClosedDate(date = {}) {
  const row = document.createElement("div");
  row.className = "grid branch-closure-row";
  row.dataset.id = date.id || "";
  row.innerHTML = '<label>Date<input class="closure-date" type="date" required value="' + esc(date.closed_date || '') + '"></label><label>Reason<input class="closure-reason" placeholder="Public holiday" value="' + esc(date.reason || '') + '"></label><button class="secondary" type="button" aria-label="Remove closed date">Remove</button>';
  row.querySelector("button").addEventListener("click", () => row.remove());
  document.querySelector("#branchClosedDatesEditor").append(row);
}
async function submitBranchForm(event) {
  event.preventDefault();
  const form = event.currentTarget, button = document.querySelector("#saveBranchButton");
  const body = Object.fromEntries(new FormData(form));
  body.hours = Array.from(document.querySelectorAll("#branchHoursEditor tr"), (row) => ({ dayOfWeek:Number(row.dataset.day), openTime:row.querySelector(".branch-open").value, closeTime:row.querySelector(".branch-close").value, isClosed:row.querySelector(".branch-closed").checked }));
  body.closedDates = Array.from(document.querySelectorAll(".branch-closure-row"), (row) => ({ id:row.dataset.id, closedDate:row.querySelector(".closure-date").value, reason:row.querySelector(".closure-reason").value }));
  body.removedDates = state.closedDates.filter((d) => d.branch_id === body.id && !body.closedDates.some((date) => date.id === d.id)).map((d) => d.id);
  if (body.hours.some((h) => !h.isClosed && h.openTime >= h.closeTime)) { document.querySelector("#branchEditorMessage").textContent = "Closing time must be after opening time."; return; }
  button.disabled = true;
  try {
    if(body.id){const actor=await askActor(body.id,true,"Authorize branch edit",false);if(!actor)return;Object.assign(body,actor);}
    await api(body.id ? "/api/branches/" + encodeURIComponent(body.id) : "/api/branches", { method:body.id ? "PATCH" : "POST", body:JSON.stringify(body) });
    document.querySelector("#branchEditor").close();
    await loadData();
  } catch (error) { document.querySelector("#branchEditorMessage").textContent = error.message; }
  finally { button.disabled = false; }
}
function renderAccess() { if (canManageAccess()) loadAccessSettings(); }
function branchTrashIcon() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>'; }
function deleteBranch(event) { openBranchAction(event.currentTarget.dataset.branchId, "archive"); }
function openBranchAction(branchId, mode) {
  const branch = [...state.branches, ...(state.archivedBranches || [])].find((b) => b.id === branchId);
  if (!branch) return;
  const form = document.querySelector("#branchActionForm"); form.reset();
  form.elements.branchId.value = branchId; form.elements.mode.value = mode;
  const permanent = mode === "permanent", restore = mode === "restore";
  document.querySelector("#branchActionTitle").textContent = (permanent ? "Permanently delete " : restore ? "Restore " : "Archive ") + branch.name + "?";
  document.querySelector("#branchActionWarning").textContent = permanent
    ? "This permanently erases the branch, its bookings, sales, stock, schedules, payroll time entries, closing records and branch-only customer profiles. Shared customer and staff profiles remain. No archive copy is kept in this app and you cannot restore it here. Type “" + branch.name + "” to continue."
    : restore ? "This restores the branch and all its retained records. It returns as Closed; use Edit branch to reopen it when you are ready."
    : "This removes the branch from active locations and disables its workspace. All records are kept in Archived branches and can be restored later. Existing bookings are retained; review any upcoming appointments before archiving.";
  document.querySelector("#branchActionNameLabel").hidden = !permanent;
  form.elements.confirmName.required = permanent;
  document.querySelector("#branchActionError").textContent = "";
  document.querySelector("#confirmBranchAction").textContent = permanent ? "Delete permanently" : restore ? "Restore branch" : "Archive branch";
  document.querySelector("#branchActionDialog").showModal();
}
async function submitBranchAction(event) {
  event.preventDefault();
  const form = event.currentTarget, body = Object.fromEntries(new FormData(form));
  const controls = [...form.querySelectorAll("input, button")]; controls.forEach((el) => el.disabled = true);
  const dialog = document.querySelector("#branchActionDialog");
  const preventCancel = (event) => event.preventDefault(); dialog.addEventListener("cancel", preventCancel);
  try {
    await api('/api/branches/' + encodeURIComponent(body.branchId) + (body.mode === "restore" ? '/restore' : ''), { method:body.mode === "restore" ? 'POST' : 'DELETE', body:JSON.stringify(body) });
    dialog.close(); await loadData();
    message.textContent = body.mode === "restore" ? "Branch restored. Edit it to reopen when ready." : body.mode === "permanent" ? "Branch permanently deleted." : "Branch archived. You can restore it from Archived branches.";
  } catch (error) { document.querySelector("#branchActionError").textContent = error.message; form.elements.pin.value = ""; }
  finally { controls.forEach((el) => el.disabled = false); dialog.removeEventListener("cancel", preventCancel); }
}
function dayName(day) { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(day)] || ''; }
function staffDaysOff(staffId) { return state.staffRegularDaysOff.filter((item) => item.staff_id === staffId).map((item) => Number(item.day_of_week)); }
function dayOffLabel(staffId) { const days = staffDaysOff(staffId); return days.length ? days.map(dayName).join(", ") : "None set"; }
function dayOffChecksHtml(staffId = "") {
  const selected = staffDaysOff(staffId);
  return [[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"]].map(([value, label]) => '<label class="day-chip"><input type="checkbox" name="days" value="' + value + '"' + (selected.includes(value) ? ' checked' : '') + '><span>' + label + '</span></label>').join("");
}
function renderStaff() {
  const search = document.querySelector("#staffSearch").value.trim().toLowerCase();
  const status = document.querySelector("#staffStatusFilter").value;
  const staffRows = state.staff.filter(person => (!status || person.status === status) && [person.name,person.role,person.email,person.phone].join(" ").toLowerCase().includes(search));
  document.querySelector("#staffCount").textContent = staffRows.length + " of " + state.staff.length + " staff · " + state.staff.filter(person => person.status === "Active").length + " active";
  document.querySelector("#staffTable").innerHTML = staffRows.map((staff) => '<tr class="staff-row" data-staff-id="' + esc(staff.id) + '" tabindex="0"><td><strong>' + esc(staff.name) + '</strong><div class="hint">' + esc(staff.email || staff.phone || "") + '</div></td><td>' + esc(staff.role || "") + '<div class="hint">Access: ' + esc(roleName(staff.access_role)) + '</div></td><td>' + esc(dayOffLabel(staff.id)) + '</td><td>' + '<span class="pill">' + esc(staff.status) + '</span></td><td><strong>' + money(staffSalesTotal(staff.id)) + '</strong></td></tr>').join("");
  if (!staffRows.length) document.querySelector("#staffTable").innerHTML = '<tr><td colspan="5" class="empty-state">No staff match your search.</td></tr>';
  if (document.querySelector("#staffForm").hidden) document.querySelector("#staffForm [data-day-off-checks]").innerHTML = dayOffChecksHtml();
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
function staffEntryHours(entry) {
  const end = entry.clock_out ? new Date(entry.clock_out) : new Date();
  let breakMinutes = Number(entry.break_minutes || 0);
  if (entry.break_started_at) breakMinutes += Math.max(0, (Date.now() - new Date(entry.break_started_at).getTime()) / 60000);
  return Math.max(0, (end.getTime() - new Date(entry.clock_in).getTime()) / 3600000 - breakMinutes / 60);
}
function staffClockTime(value) { return value ? new Date(value).toLocaleTimeString("en-AU", { hour:"numeric", minute:"2-digit" }) : "—"; }
function renderStaffHours(staff) {
  const today = new Date();
  const entries = (state.timeEntries || []).filter((entry) => entry.staff_id === staff.id);
  const days = Array.from({ length:14 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - index);
    const dateKey = localIsoDate(date);
    const dayEntries = entries.filter((entry) => localIsoDate(new Date(entry.clock_in)) === dateKey);
    const clockIns = dayEntries.map((entry) => entry.clock_in).filter(Boolean).sort();
    const clockOuts = dayEntries.map((entry) => entry.clock_out).filter(Boolean).sort();
    const breakMinutes = dayEntries.reduce((sum, entry) => sum + Number(entry.break_minutes || 0) + (entry.break_started_at ? Math.max(0, Math.round((Date.now() - new Date(entry.break_started_at).getTime()) / 60000)) : 0), 0);
    const hours = dayEntries.reduce((sum, entry) => sum + staffEntryHours(entry), 0);
    const branches = [...new Set(dayEntries.map((entry) => entry.branch_name || branchName(entry.branch_id)).filter(Boolean))];
    return { date, dateKey, branches, clockIn:clockIns[0] || "", clockOut:clockOuts.at(-1) || "", open:dayEntries.some((entry) => !entry.clock_out), breakMinutes, hours };
  });
  document.querySelector("#staffHoursTable").innerHTML = days.map((day) => '<tr class="' + (day.hours ? '' : 'no-hours-row') + '"><td><strong>' + esc(day.date.toLocaleDateString("en-AU", { weekday:"short", day:"numeric", month:"short" })) + '</strong></td><td>' + esc(day.branches.join(", ") || "—") + '</td><td>' + esc(staffClockTime(day.clockIn)) + '</td><td>' + day.breakMinutes + ' min</td><td>' + (day.open ? '<span class="status-pill inactive">In progress</span>' : esc(staffClockTime(day.clockOut))) + '</td><td><strong>' + day.hours.toFixed(2) + '</strong></td></tr>').join("");
  const totalHours = days.reduce((sum, day) => sum + day.hours, 0);

  document.querySelector("#staffHoursSummary").textContent = totalHours.toFixed(2) + " hours";
}
function openStaffProfile(staffId) {
  const staff = state.staff.find((item) => item.id === staffId);
  if (!staff) return;
  const form = document.querySelector("#staffProfileForm");
  form.elements.staffId.value = staff.id;
  form.elements.name.value = staff.name;
  form.elements.role.value = staff.role || "";
  form.elements.accessRole.value = staff.access_role || "none";
  form.elements.email.value = staff.email || "";
  form.elements.phone.value = staff.phone || "";

  form.elements.xeroEmployeeId.value = staff.xero_employee_id || "";
  form.elements.xeroEarningsRateId.value = staff.xero_earnings_rate_id || "";
  form.elements.status.value = staff.status || "Active";
  form.querySelector("[data-day-off-checks]").innerHTML = dayOffChecksHtml(staffId);
  const rows = staffSaleRows(staffId);
  document.querySelector("#staffProfileTitle").textContent = staff.name;
  document.querySelector("#staffProfileSummary").textContent = rows.length + " service sale" + (rows.length === 1 ? "" : "s") + " · " + money(staffSalesTotal(staffId)) + " credited sales";
  document.querySelector("#staffSalesTable").innerHTML = rows.length ? rows.map((item) => '<tr><td>' + esc(formatCustomerDate(item.created_at)) + '</td><td>' + esc(item.branch_name || branchName(item.branch_id)) + '</td><td>' + esc(item.item_name) + '</td><td>' + money(item.price_cents) + '</td><td><strong>' + money(item.credit) + '</strong></td></tr>').join("") : '<tr><td colspan="5" class="empty-cell">No credited sales yet.</td></tr>';
  renderStaffHours(staff);
  renderStaffLogin();
  document.querySelector("#staffProfile").classList.remove("hidden");
  document.querySelector("#staffProfile").scrollIntoView({ behavior:"smooth", block:"start" });
}
async function submitStaffForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const days = [...form.querySelectorAll('input[name="days"]:checked')].map((input) => Number(input.value));
  try {
    const login=staffLoginValues(form);
    message.textContent = "Saving staff...";
    const result = form.elements.staffId.value ? (await api("/api/staff/"+encodeURIComponent(form.elements.staffId.value), {method:"PATCH",body:JSON.stringify(data)}), {id:form.elements.staffId.value}) : await api("/api/staff", { method:"POST", body:JSON.stringify(data) });
    form.elements.staffId.value=result.id;
    await saveStaffLogin(result.id,login);
    await api("/api/staff-regular-days-off", { method:"POST", body:JSON.stringify({ staffId:result.id, days }) });
    form.reset(); closeStaffAdd(); await loadData(); openStaffProfile(result.id); message.textContent = "Staff member saved.";
  } catch (error) { message.textContent = error.message; }
}
async function submitStaffProfile(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const staffId = data.staffId;
  const days = [...event.currentTarget.querySelectorAll('input[name="days"]:checked')].map((input) => Number(input.value));
  try { const login=staffLoginValues(event.currentTarget); message.textContent = "Saving staff details..."; await api("/api/staff/" + encodeURIComponent(staffId), { method:"PATCH", body:JSON.stringify(data) }); await api("/api/staff-regular-days-off", { method:"POST", body:JSON.stringify({ staffId, days }) }); await saveStaffLogin(staffId,login); await loadData(); openStaffProfile(staffId); message.textContent = "Staff details saved."; }
  catch (error) { message.textContent = error.message; }
}
function closeStaffProfile() { document.querySelector("#staffProfile").classList.add("hidden"); }
function setInitialRosterWeek() {
  const today = new Date().toISOString().slice(0, 10);
  document.querySelector("#rosterMonth").value = today.slice(0, 7);
  document.querySelector("#rosterDay").value = today;
}
function setInitialReportRange() {
  const today = new Date().toISOString().slice(0, 10);
  document.querySelector("#reportFrom").value = today.slice(0, 8) + "01";
  document.querySelector("#reportTo").value = today;
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
function catalogueTextCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), "en", { numeric:true, sensitivity:"base" });
}
function serviceCategoryCompare(left, right) {
  const leftSpecial = String(left || "").trim().toLowerCase().includes("special");
  const rightSpecial = String(right || "").trim().toLowerCase().includes("special");
  if (leftSpecial !== rightSpecial) return leftSpecial ? -1 : 1;
  return catalogueTextCompare(left, right);
}
function serviceCategoryPinned(category) {
  const saved = state.serviceCategoryOrder.find((item) => item.category === category);
  return saved ? Boolean(saved.pinned) : String(category || "").trim().toLowerCase().includes("special");
}
function serviceCategoryDisplayCompare(left, right) {
  const leftPinned = serviceCategoryPinned(left), rightPinned = serviceCategoryPinned(right);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  const saved = new Map(state.serviceCategoryOrder.map((item, index) => [item.category, Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index]));
  const leftOrder = saved.has(left) ? saved.get(left) : Number.MAX_SAFE_INTEGER;
  const rightOrder = saved.has(right) ? saved.get(right) : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || catalogueTextCompare(left, right);
}
function refreshCatalogueFilter(selector, values, allLabel, compare = catalogueTextCompare) {
  const select = document.querySelector(selector), current = select.value;
  const options = [...new Set(values)].sort(compare);
  select.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + options.map((value) => '<option value="' + esc(value) + '">' + esc(value) + '</option>').join("");
  select.value = options.includes(current) ? current : "";
  return select.value;
}
function catalogueGroups(items, field, fallback) {
  const groups = new Map();
  for (const item of items) {
    const key = item[field] || fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([left], [right]) => catalogueTextCompare(left, right));
}
function catalogueGroupHeading(name, count, columns, subGroup = false) {
  return '<tr class="catalogue-' + (subGroup ? 'subgroup' : 'group') + '"><th colspan="' + columns + '"><span>' + esc(name) + '</span><span class="catalogue-group-count">' + count + (count === 1 ? ' item' : ' items') + '</span></th></tr>';
}
function serviceSubCategoryKey(category, subCategory) { return JSON.stringify([category, subCategory]); }
function populateServiceSelect(field, values, selected = "") {
  const select = document.querySelector("#serviceForm").elements[field];
  const label = field === "category" ? "category" : "sub-category";
  const options = [...new Set(values.filter(Boolean))].sort(field === "category" ? serviceCategoryDisplayCompare : catalogueTextCompare);
  select.innerHTML = '<option value="" disabled selected>Choose a ' + label + '</option>' + options.map((value) => '<option value="' + esc(value) + '">' + esc(value) + '</option>').join("") + '<option value="" data-new-value="true">+ Add new ' + label + '…</option>';
  if (selected && options.includes(selected)) select.value = selected;
  toggleNewServiceValue(field);
}
function toggleNewServiceValue(field, focus = false) {
  const form = document.querySelector("#serviceForm");
  const select = form.elements[field];
  const custom = select.selectedOptions[0]?.dataset.newValue === "true";
  const input = form.elements[field === "category" ? "newCategory" : "newSubCategory"];
  const label = document.querySelector(field === "category" ? "#newServiceCategoryLabel" : "#newServiceSubCategoryLabel");
  label.classList.toggle("hidden", !custom);
  input.disabled = !custom;
  input.required = custom;
  select.required = !custom;
  if (custom && focus) input.focus();
}
function selectedServiceCategory() {
  const form = document.querySelector("#serviceForm");
  return form.elements.category.selectedOptions[0]?.dataset.newValue === "true" ? form.elements.newCategory.value.trim() : form.elements.category.value;
}
function refreshServiceSubCategories(selected, preserve = false) {
  const form = document.querySelector("#serviceForm");
  const category = selectedServiceCategory();
  const current = selected === undefined ? form.elements.subCategory.value : selected;
  const values = ["General", ...state.services.filter((service) => (service.category || "General") === category).map((service) => service.sub_category || "General")];
  if (preserve && current) values.push(current);
  populateServiceSelect("subCategory", values, current);
}
function refreshServiceEditor(category = "", subCategory = "") {
  populateServiceSelect("category", ["General", ...state.services.map((service) => service.category || "General"), category], category);
  refreshServiceSubCategories(subCategory, true);
}
function renderServices() {
  const query = document.querySelector("#serviceSearch").value.trim().toLowerCase();
  const category = refreshCatalogueFilter("#serviceCategoryFilter", state.services.map((service) => service.category || "General"), "All categories", serviceCategoryDisplayCompare);
  const categoryServices = state.services.filter((service) => !category || (service.category || "General") === category);
  const subCategory = refreshCatalogueFilter("#serviceSubCategoryFilter", categoryServices.map((service) => service.sub_category || "General"), "All sub-categories");
  const status = document.querySelector("#serviceStatusFilter").value;
  const filtered = Boolean(query || category || subCategory || status);
  const services = categoryServices.filter((service) => (!subCategory || (service.sub_category || "General") === subCategory) && (!status || (service.status || "Active") === status) && (!query || [service.name, service.category || "General", service.sub_category || "General", service.status || "Active"].some((value) => String(value).toLowerCase().includes(query))));
  if (document.querySelector("#serviceForm").classList.contains("hidden")) refreshServiceEditor();
  document.querySelector("#serviceCount").textContent = services.length + " of " + state.services.length + " services · Open a category, then a sub-category, to view services";
  document.querySelector("#servicesHierarchy").innerHTML = catalogueGroups(services, "category", "General").sort(([left], [right]) => serviceCategoryDisplayCompare(left, right)).map(([category, categoryServices]) => {
    const categoryOpen = filtered || expandedServiceCategories.has(category);
    const subCategories = catalogueGroups(categoryServices, "sub_category", "General").map(([subCategory, group]) => {
      const key = serviceSubCategoryKey(category, subCategory);
      const subCategoryOpen = filtered || expandedServiceSubCategories.has(key);
      const serviceItems = group.map((service) => '<article class="service-hierarchy-item"><div><strong>' + esc(service.name) + '</strong><span>' + esc(service.duration_minutes) + ' min</span></div><div class="service-hierarchy-item-meta"><strong>' + money(service.price_cents) + '</strong><span class="status-pill ' + (service.status === "Inactive" ? "inactive" : "") + '">' + esc(service.status || "Active") + '</span><button class="edit-service" data-service-id="' + esc(service.id) + '" type="button" title="Edit service" aria-label="Edit ' + esc(service.name) + '">✎</button></div></article>').join("");
      return '<details class="service-subcategory-menu" data-service-category="' + esc(category) + '" data-service-sub-category="' + esc(subCategory) + '"' + (subCategoryOpen ? ' open' : '') + '><summary><span>' + esc(subCategory) + '</span><button class="catalogue-name-edit edit-service-subcategory" type="button" data-category="' + esc(category) + '" data-sub-category="' + esc(subCategory) + '" title="Rename sub-category" aria-label="Rename ' + esc(subCategory) + ' sub-category">✎</button><span class="catalogue-group-count">' + group.length + (group.length === 1 ? ' service' : ' services') + '</span></summary><div class="service-hierarchy-items">' + serviceItems + '</div></details>';
    }).join("");
    const pinned = serviceCategoryPinned(category);
    const categoryControl = '<button class="service-category-drag-handle" type="button" draggable="true" data-drag-category="' + esc(category) + '" title="Drag to reorder category" aria-label="Drag ' + esc(category) + ' to reorder. Use the up and down arrow keys for keyboard reordering.">⋮⋮</button><button class="service-category-pin' + (pinned ? ' pinned' : '') + '" type="button" data-pin-category="' + esc(category) + '" aria-pressed="' + String(pinned) + '" title="' + (pinned ? 'Unpin category' : 'Pin category to the top everywhere') + '" aria-label="' + (pinned ? 'Unpin ' : 'Pin ') + esc(category) + '">📌</button>';
    return '<details class="service-category-menu" data-service-category-container="' + esc(category) + '"' + (categoryOpen ? ' open' : '') + '><summary>' + categoryControl + '<span>' + esc(category) + '</span><button class="catalogue-name-edit edit-service-category" type="button" data-category="' + esc(category) + '" title="Rename category" aria-label="Rename ' + esc(category) + ' category">✎</button><span class="catalogue-group-count">' + categoryServices.length + (categoryServices.length === 1 ? ' service' : ' services') + '</span></summary><div class="service-subcategory-list">' + subCategories + '</div></details>';
  }).join("") || '<p class="empty-cell service-hierarchy-empty">' + (filtered ? 'No services match these filters or search.' : 'No services yet. Click Add service to create one.') + '</p>';
  document.querySelectorAll("[data-service-category-container]").forEach((details) => details.addEventListener("toggle", () => {
    const value = details.dataset.serviceCategoryContainer;
    if (details.open) {
      expandedServiceCategories.clear();
      expandedServiceCategories.add(value);
      document.querySelectorAll("[data-service-category-container]").forEach((other) => { if (other !== details) other.open = false; });
    } else expandedServiceCategories.delete(value);
  }));
  document.querySelectorAll("[data-service-sub-category]").forEach((details) => details.addEventListener("toggle", () => {
    const key = serviceSubCategoryKey(details.dataset.serviceCategory, details.dataset.serviceSubCategory);
    if (details.open) {
      expandedServiceSubCategories.add(key);
      details.parentElement.querySelectorAll("[data-service-sub-category]").forEach((other) => {
        if (other !== details) {
          expandedServiceSubCategories.delete(serviceSubCategoryKey(other.dataset.serviceCategory, other.dataset.serviceSubCategory));
          other.open = false;
        }
      });
    } else expandedServiceSubCategories.delete(key);
  }));
  document.querySelectorAll(".service-category-drag-handle").forEach((handle) => {
    handle.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener("dragstart", (event) => {
      draggedServiceCategory = handle.dataset.dragCategory;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedServiceCategory);
      handle.closest(".service-category-menu").classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      draggedServiceCategory = "";
      document.querySelectorAll(".service-category-menu").forEach((menu) => menu.classList.remove("dragging", "drag-over", "drag-after"));
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      moveServiceCategory(handle.dataset.dragCategory, event.key === "ArrowDown" ? 1 : -1);
    });
  });
  document.querySelectorAll(".service-category-pin").forEach((button) => button.addEventListener("click", toggleServiceCategoryPin));
  if (!filtered) document.querySelectorAll(".service-category-menu").forEach((menu) => {
    menu.addEventListener("dragover", (event) => {
      if (!draggedServiceCategory || draggedServiceCategory === menu.dataset.serviceCategoryContainer) return;
      event.preventDefault();
      const after = event.clientY > menu.getBoundingClientRect().top + menu.getBoundingClientRect().height / 2;
      document.querySelectorAll(".service-category-menu").forEach((item) => item.classList.remove("drag-over", "drag-after"));
      menu.classList.add("drag-over");
      if (after) menu.classList.add("drag-after");
    });
    menu.addEventListener("dragleave", () => menu.classList.remove("drag-over", "drag-after"));
    menu.addEventListener("drop", (event) => {
      event.preventDefault();
      const after = menu.classList.contains("drag-after");
      reorderServiceCategories(draggedServiceCategory || event.dataTransfer.getData("text/plain"), menu.dataset.serviceCategoryContainer, after);
    });
  });
  document.querySelectorAll(".edit-service-category").forEach((button) => button.addEventListener("click", renameServiceCategoryFromMenu));
  document.querySelectorAll(".edit-service-subcategory").forEach((button) => button.addEventListener("click", renameServiceSubCategoryFromMenu));
  document.querySelectorAll(".edit-service").forEach((button) => button.addEventListener("click", editService));
}
function currentServiceCategoryNames() {
  return [...new Set(state.services.map((service) => service.category || "General"))].sort(serviceCategoryDisplayCompare);
}
async function persistServiceCategoryOrder(categories, focusCategory = "") {
  const previous = state.serviceCategoryOrder;
  const pins = new Map(previous.map((item) => [item.category, Number(item.pinned) ? 1 : 0]));
  state.serviceCategoryOrder = categories.map((category, sort_order) => ({ category, sort_order, pinned:pins.has(category) ? pins.get(category) : (category.trim().toLowerCase().includes("special") ? 1 : 0) }));
  renderServices();
  try {
    const result = await api("/api/services/category-order", { method:"POST", body:JSON.stringify({ categories }) });
    state.serviceCategoryOrder = result.categories;
    renderServices();
    if (focusCategory) document.querySelector('[data-drag-category="' + CSS.escape(focusCategory) + '"]')?.focus();
    message.textContent = "Service category order saved.";
  } catch (error) {
    state.serviceCategoryOrder = previous;
    renderServices();
    message.textContent = error.message;
  }
}
function reorderServiceCategories(dragged, target, after = false) {
  if (!dragged || dragged === target) return;
  const categories = currentServiceCategoryNames();
  const pinned = categories.filter(serviceCategoryPinned), regular = categories.filter((category) => !serviceCategoryPinned(category));
  const group = serviceCategoryPinned(dragged) ? pinned : regular;
  group.splice(group.indexOf(dragged), 1);
  const targetInGroup = group.indexOf(target);
  let index = targetInGroup >= 0 ? targetInGroup + (after ? 1 : 0) : serviceCategoryPinned(dragged) ? group.length : 0;
  group.splice(index, 0, dragged);
  persistServiceCategoryOrder([...pinned, ...regular], dragged);
}
function moveServiceCategory(category, direction) {
  const categories = currentServiceCategoryNames();
  const pinned = categories.filter(serviceCategoryPinned), regular = categories.filter((name) => !serviceCategoryPinned(name));
  const group = serviceCategoryPinned(category) ? pinned : regular;
  const index = group.indexOf(category), next = index + direction;
  if (index < 0 || next < 0 || next >= group.length) return;
  [group[index], group[next]] = [group[next], group[index]];
  persistServiceCategoryOrder([...pinned, ...regular], category);
}
async function toggleServiceCategoryPin(event) {
  event.preventDefault(); event.stopPropagation();
  const category = event.currentTarget.dataset.pinCategory;
  const pinned = !serviceCategoryPinned(category);
  try {
    await api("/api/services/category-pin", { method:"PATCH", body:JSON.stringify({ category, pinned }) });
    const current = state.serviceCategoryOrder.find((item) => item.category === category);
    if (current) current.pinned = pinned ? 1 : 0;
    else state.serviceCategoryOrder.push({ category, sort_order:state.serviceCategoryOrder.length, pinned:pinned ? 1 : 0 });
    renderServices();
    message.textContent = 'Category "' + category + '" ' + (pinned ? 'pinned to the top everywhere.' : 'unpinned.');
  } catch (error) { message.textContent = error.message; }
}
async function renameServiceCategoryFromMenu(event) {
  event.preventDefault(); event.stopPropagation();
  const oldName = event.currentTarget.dataset.category;
  const newName = prompt("Rename service category", oldName)?.trim();
  if (!newName || newName === oldName) return;
  const merging = state.services.some((service) => (service.category || "General") === newName);
  if (merging && !confirm('A category named "' + newName + '" already exists. Merge these categories?')) return;
  try {
    await api("/api/services/category-name", { method:"PATCH", body:JSON.stringify({ oldName, newName }) });
    expandedServiceCategories.delete(oldName);
    expandedServiceCategories.add(newName);
    await loadData();
    message.textContent = 'Category renamed to "' + newName + '".';
  } catch (error) { message.textContent = error.message; }
}
async function renameServiceSubCategoryFromMenu(event) {
  event.preventDefault(); event.stopPropagation();
  const category = event.currentTarget.dataset.category;
  const oldName = event.currentTarget.dataset.subCategory;
  const newName = prompt("Rename service sub-category", oldName)?.trim();
  if (!newName || newName === oldName) return;
  const merging = state.services.some((service) => (service.category || "General") === category && (service.sub_category || "General") === newName);
  if (merging && !confirm('A sub-category named "' + newName + '" already exists here. Merge these sub-categories?')) return;
  try {
    await api("/api/services/subcategory-name", { method:"PATCH", body:JSON.stringify({ category, oldName, newName }) });
    expandedServiceSubCategories.delete(serviceSubCategoryKey(category, oldName));
    expandedServiceSubCategories.add(serviceSubCategoryKey(category, newName));
    await loadData();
    message.textContent = 'Sub-category renamed to "' + newName + '".';
  } catch (error) { message.textContent = error.message; }
}
function openServiceForm() {
  const form = document.querySelector("#serviceForm");
  form.classList.remove("hidden");
  document.querySelector("#addServiceButton").setAttribute("aria-expanded", "true");
  form.scrollIntoView({ behavior:"smooth", block:"start" });
  form.elements.name.focus({ preventScroll:true });
}

function editService(event) {
  event.stopPropagation();
  const service = state.services.find((item) => item.id === event.currentTarget.dataset.serviceId);
  if (!service) return;
  const form = document.querySelector("#serviceForm");
  form.elements.serviceId.value = service.id;
  form.elements.name.value = service.name;
  refreshServiceEditor(service.category || "General", service.sub_category || "General");
  form.elements.durationMinutes.value = service.duration_minutes;
  form.elements.price.value = (Number(service.price_cents || 0) / 100).toFixed(2);
  form.elements.status.value = service.status || "Active";
  document.querySelector("#serviceFormTitle").textContent = "Edit service";
  document.querySelector("#serviceSaveButton").textContent = "Update service";
  openServiceForm();
}
function resetServiceForm() {
  const form = document.querySelector("#serviceForm");
  form.reset();
  form.elements.serviceId.value = "";
  refreshServiceEditor();
  document.querySelector("#serviceFormTitle").textContent = "Add service";
  document.querySelector("#serviceSaveButton").textContent = "Save service";
  form.classList.add("hidden");
  document.querySelector("#addServiceButton").setAttribute("aria-expanded", "false");
  document.querySelector("#addServiceButton").focus({ preventScroll:true });
}
async function submitServiceForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const serviceId = payload.serviceId;
  payload.category = selectedServiceCategory();
  payload.subCategory = form.elements.subCategory.selectedOptions[0]?.dataset.newValue === "true" ? form.elements.newSubCategory.value.trim() : form.elements.subCategory.value;
  delete payload.newCategory;
  delete payload.newSubCategory;
  if (!payload.category || !payload.subCategory) { message.textContent = "Choose or enter a category and sub-category."; return; }
  try {
    message.textContent = serviceId ? "Updating service..." : "Saving service...";
    await api(serviceId ? "/api/services/" + encodeURIComponent(serviceId) : "/api/services", { method:serviceId ? "PATCH" : "POST", body:JSON.stringify(payload) });
    resetServiceForm();
    await loadData();
    message.textContent = serviceId ? "Service updated." : "Service added.";
  } catch (error) { message.textContent = error.message; }
}
function productCategoryDisplayCompare(left, right) {
  const saved = new Map(state.productCategoryOrder.map((item, index) => [item.category, Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index]));
  const leftOrder = saved.has(left) ? saved.get(left) : Number.MAX_SAFE_INTEGER;
  const rightOrder = saved.has(right) ? saved.get(right) : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || catalogueTextCompare(left, right);
}
function productSubCategoryKey(category, subCategory) { return JSON.stringify([category, subCategory]); }
function currentProductCategoryNames() {
  return [...new Set(state.products.map((product) => product.category || "Retail"))].sort(productCategoryDisplayCompare);
}
function renderProducts() {
  const query = document.querySelector("#productSearch")?.value.trim().toLowerCase() || "";
  const category = refreshCatalogueFilter("#productCategoryFilter", state.products.map((product) => product.category || "Retail"), "All categories", productCategoryDisplayCompare);
  const categoryProducts = state.products.filter((product) => !category || (product.category || "Retail") === category);
  const subCategory = refreshCatalogueFilter("#productSubCategoryFilter", categoryProducts.map((product) => product.sub_category || "General"), "All sub-categories");
  const subCategoryProducts = categoryProducts.filter((product) => !subCategory || (product.sub_category || "General") === subCategory);
  const brand = refreshCatalogueFilter("#productBrandFilter", subCategoryProducts.map((product) => product.brand || "Unbranded"), "All brands");
  const status = document.querySelector("#productStatusFilter").value;
  const filtered = Boolean(query || category || subCategory || brand || status);
  const stockByProduct = new Map();
  for (const item of state.inventoryStock || []) {
    if (!selectedProductBranchId || item.branch_id === selectedProductBranchId) stockByProduct.set(item.product_id, (stockByProduct.get(item.product_id) || 0) + Number(item.quantity || 0));
  }
  const products = subCategoryProducts.filter((product) => (!brand || (product.brand || "Unbranded") === brand) && (!status || (product.status || "Active") === status) && (!query || [product.name, product.brand, product.category || "Retail", product.sub_category || "General", product.sku, product.barcode, product.status || "Active"].some((value) => String(value || "").toLowerCase().includes(query)))).map((product) => ({ ...product, stock:stockByProduct.get(product.id) || 0 }));
  const branch = state.branches.find((item) => item.id === selectedProductBranchId);
  const stockLabel = branch ? branch.name : "All branches";
  document.querySelector("#productTableTitle").textContent = branch ? branch.name + " products" : "All products";
  document.querySelector("#productCount").textContent = products.length + " of " + state.products.length + " product" + (state.products.length === 1 ? "" : "s") + " · Stock for " + stockLabel + " · Drag a product onto another category or sub-category to move it";
  document.querySelector("#productsHierarchy").innerHTML = catalogueGroups(products, "category", "Retail").sort(([left], [right]) => productCategoryDisplayCompare(left, right)).map(([categoryName, categoryGroup]) => {
    const categoryOpen = filtered || expandedProductCategories.has(categoryName);
    const subCategories = catalogueGroups(categoryGroup, "sub_category", "General").map(([subCategoryName, group]) => {
      const key = productSubCategoryKey(categoryName, subCategoryName);
      const subCategoryOpen = filtered || expandedProductSubCategories.has(key);
      const productItems = group.map((product) => {
        const special = Number(product.special_price_cents || 0);
        const prices = special > 0 ? '<span class="product-price-retail discounted">' + money(product.price_cents) + '</span><strong class="product-price-special">' + money(special) + '</strong>' : '<strong>' + money(product.price_cents) + '</strong>';
        return '<article class="product-hierarchy-item" draggable="true" data-product-id="' + esc(product.id) + '"><div class="product-item-main"><strong>' + esc(product.name) + '</strong><span>' + esc(product.brand || "Unbranded") + ' · SKU ' + esc(product.sku || "—") + (product.barcode ? ' · Barcode ' + esc(product.barcode) : '') + '</span></div><div class="product-hierarchy-item-meta"><span><strong class="stock-quantity">' + product.stock + '</strong> in stock</span><span>Cost ' + money(product.cost_cents) + '</span><span class="product-prices">' + prices + '</span><span class="status-pill ' + (product.status === "Inactive" ? "inactive" : "") + '">' + esc(product.status || "Active") + '</span><button class="secondary compact-button edit-product" type="button" data-product-id="' + esc(product.id) + '">Edit</button></div></article>';
      }).join("");
      return '<details class="product-subcategory-menu" data-product-category="' + esc(categoryName) + '" data-product-sub-category="' + esc(subCategoryName) + '"' + (subCategoryOpen ? ' open' : '') + '><summary><span>' + esc(subCategoryName) + '</span><button class="catalogue-name-edit edit-product-subcategory" type="button" data-category="' + esc(categoryName) + '" data-sub-category="' + esc(subCategoryName) + '" title="Rename sub-category" aria-label="Rename ' + esc(subCategoryName) + ' sub-category">✎</button><span class="catalogue-group-count">' + group.length + (group.length === 1 ? ' product' : ' products') + '</span></summary><div class="product-hierarchy-items">' + productItems + '</div></details>';
    }).join("");
    const categoryControl = '<button class="product-category-drag-handle" type="button" draggable="true" data-drag-category="' + esc(categoryName) + '" title="Drag to reorder category" aria-label="Drag ' + esc(categoryName) + ' to reorder. Use the up and down arrow keys for keyboard reordering.">⋮⋮</button>';
    return '<details class="product-category-menu" data-product-category-container="' + esc(categoryName) + '"' + (categoryOpen ? ' open' : '') + '><summary>' + categoryControl + '<span>' + esc(categoryName) + '</span><button class="catalogue-name-edit edit-product-category" type="button" data-category="' + esc(categoryName) + '" title="Rename category" aria-label="Rename ' + esc(categoryName) + ' category">✎</button><span class="catalogue-group-count">' + categoryGroup.length + (categoryGroup.length === 1 ? ' product' : ' products') + '</span></summary><div class="product-subcategory-list">' + subCategories + '</div></details>';
  }).join("") || '<p class="empty-cell product-hierarchy-empty">' + (filtered ? 'No products match these filters or search.' : 'No products yet. Add a product to get started.') + '</p>';
  document.querySelectorAll("[data-product-category-container]").forEach((details) => details.addEventListener("toggle", () => {
    const value = details.dataset.productCategoryContainer;
    if (details.open) {
      expandedProductCategories.clear();
      expandedProductCategories.add(value);
      document.querySelectorAll("[data-product-category-container]").forEach((other) => { if (other !== details) other.open = false; });
    } else expandedProductCategories.delete(value);
  }));
  document.querySelectorAll("[data-product-sub-category]").forEach((details) => details.addEventListener("toggle", () => {
    const key = productSubCategoryKey(details.dataset.productCategory, details.dataset.productSubCategory);
    if (details.open) {
      expandedProductSubCategories.add(key);
      details.parentElement.querySelectorAll("[data-product-sub-category]").forEach((other) => {
        if (other !== details) {
          expandedProductSubCategories.delete(productSubCategoryKey(other.dataset.productCategory, other.dataset.productSubCategory));
          other.open = false;
        }
      });
    } else expandedProductSubCategories.delete(key);
  }));
  document.querySelectorAll(".product-category-drag-handle").forEach((handle) => {
    handle.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
    handle.addEventListener("dragstart", (event) => {
      draggedProductCategory = handle.dataset.dragCategory;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedProductCategory);
      handle.closest(".product-category-menu").classList.add("dragging");
    });
    handle.addEventListener("dragend", clearProductDragStyles);
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      moveProductCategoryByKeyboard(handle.dataset.dragCategory, event.key === "ArrowDown" ? 1 : -1);
    });
  });
  document.querySelectorAll(".product-hierarchy-item").forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      draggedProductId = item.dataset.productId;
      draggedProductCategory = "";
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-kunchas-product", draggedProductId);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", clearProductDragStyles);
  });
  document.querySelectorAll(".product-category-menu>summary").forEach((summary) => bindProductDropTarget(summary, () => ({ category:summary.parentElement.dataset.productCategoryContainer, subCategory:"General" })));
  document.querySelectorAll(".product-subcategory-menu").forEach((menu) => bindProductDropTarget(menu, () => ({ category:menu.dataset.productCategory, subCategory:menu.dataset.productSubCategory })));
  if (!filtered) document.querySelectorAll(".product-category-menu").forEach((menu) => {
    menu.addEventListener("dragover", (event) => {
      if (!draggedProductCategory || draggedProductCategory === menu.dataset.productCategoryContainer) return;
      event.preventDefault();
      const after = event.clientY > menu.getBoundingClientRect().top + menu.getBoundingClientRect().height / 2;
      document.querySelectorAll(".product-category-menu").forEach((item) => item.classList.remove("drag-over", "drag-after"));
      menu.classList.add("drag-over");
      if (after) menu.classList.add("drag-after");
    });
    menu.addEventListener("dragleave", () => menu.classList.remove("drag-over", "drag-after"));
    menu.addEventListener("drop", (event) => {
      if (!draggedProductCategory) return;
      event.preventDefault();
      reorderProductCategories(draggedProductCategory, menu.dataset.productCategoryContainer, menu.classList.contains("drag-after"));
    });
  });
  document.querySelectorAll(".edit-product-category").forEach((button) => button.addEventListener("click", renameProductCategoryFromMenu));
  document.querySelectorAll(".edit-product-subcategory").forEach((button) => button.addEventListener("click", renameProductSubCategoryFromMenu));
  document.querySelectorAll(".edit-product").forEach((button) => button.addEventListener("click", editProduct));
}
function clearProductDragStyles() {
  draggedProductCategory = "";
  draggedProductId = "";
  document.querySelectorAll(".product-category-menu,.product-subcategory-menu,.product-hierarchy-item").forEach((item) => item.classList.remove("dragging", "drag-over", "drag-after", "product-drop-target"));
}
function bindProductDropTarget(element, destination) {
  element.addEventListener("dragover", (event) => {
    if (!draggedProductId) return;
    event.preventDefault(); event.stopPropagation();
    element.classList.add("product-drop-target");
  });
  element.addEventListener("dragleave", () => element.classList.remove("product-drop-target"));
  element.addEventListener("drop", (event) => {
    if (!draggedProductId) return;
    event.preventDefault(); event.stopPropagation();
    const target = destination();
    moveProductToGroup(draggedProductId, target.category, target.subCategory);
  });
}
async function persistProductCategoryOrder(categories, focusCategory = "") {
  const previous = state.productCategoryOrder;
  state.productCategoryOrder = categories.map((category, sort_order) => ({ category, sort_order }));
  renderProducts();
  try {
    const result = await api("/api/products/category-order", { method:"POST", body:JSON.stringify({ categories }) });
    state.productCategoryOrder = result.categories.map((category, sort_order) => ({ category, sort_order }));
    renderProducts();
    if (focusCategory) document.querySelector('[data-drag-category="' + CSS.escape(focusCategory) + '"]')?.focus();
    message.textContent = "Product category order saved.";
  } catch (error) {
    state.productCategoryOrder = previous;
    renderProducts();
    message.textContent = error.message;
  }
}
function reorderProductCategories(dragged, target, after = false) {
  if (!dragged || dragged === target) return;
  const categories = currentProductCategoryNames();
  categories.splice(categories.indexOf(dragged), 1);
  const targetIndex = categories.indexOf(target);
  categories.splice(targetIndex + (after ? 1 : 0), 0, dragged);
  persistProductCategoryOrder(categories, dragged);
}
function moveProductCategoryByKeyboard(category, direction) {
  const categories = currentProductCategoryNames();
  const index = categories.indexOf(category), next = index + direction;
  if (index < 0 || next < 0 || next >= categories.length) return;
  [categories[index], categories[next]] = [categories[next], categories[index]];
  persistProductCategoryOrder(categories, category);
}
async function moveProductToGroup(productId, category, subCategory) {
  const product = state.products.find((item) => item.id === productId);
  clearProductDragStyles();
  if (!product || ((product.category || "Retail") === category && (product.sub_category || "General") === subCategory)) return;
  try {
    await api("/api/products/move", { method:"PATCH", body:JSON.stringify({ productId, category, subCategory }) });
    product.category = category;
    product.sub_category = subCategory;
    await loadData();
    message.textContent = 'Product moved to "' + category + ' / ' + subCategory + '".';
  } catch (error) { message.textContent = error.message; }
}
async function renameProductCategoryFromMenu(event) {
  event.preventDefault(); event.stopPropagation();
  const oldName = event.currentTarget.dataset.category;
  const newName = prompt("Rename product category", oldName)?.trim();
  if (!newName || newName === oldName) return;
  const merging = state.products.some((product) => (product.category || "Retail") === newName);
  if (merging && !confirm('A category named "' + newName + '" already exists. Merge these categories?')) return;
  try {
    await api("/api/products/category-name", { method:"PATCH", body:JSON.stringify({ oldName, newName }) });
    expandedProductCategories.delete(oldName);
    expandedProductCategories.add(newName);
    await loadData();
    message.textContent = 'Product category renamed to "' + newName + '".';
  } catch (error) { message.textContent = error.message; }
}
async function renameProductSubCategoryFromMenu(event) {
  event.preventDefault(); event.stopPropagation();
  const category = event.currentTarget.dataset.category;
  const oldName = event.currentTarget.dataset.subCategory;
  const newName = prompt("Rename product sub-category", oldName)?.trim();
  if (!newName || newName === oldName) return;
  const merging = state.products.some((product) => (product.category || "Retail") === category && (product.sub_category || "General") === newName);
  if (merging && !confirm('A sub-category named "' + newName + '" already exists here. Merge these sub-categories?')) return;
  try {
    await api("/api/products/subcategory-name", { method:"PATCH", body:JSON.stringify({ category, oldName, newName }) });
    expandedProductSubCategories.delete(productSubCategoryKey(category, oldName));
    expandedProductSubCategories.add(productSubCategoryKey(category, newName));
    await loadData();
    message.textContent = 'Product sub-category renamed to "' + newName + '".';
  } catch (error) { message.textContent = error.message; }
}
function editProduct(event) {
  event.stopPropagation();
  const product = state.products.find((item) => item.id === event.currentTarget.dataset.productId);
  if (!product) return;
  const form = document.querySelector("#productForm");
  form.elements.productId.value = product.id;
  form.elements.name.value = product.name || "";
  form.elements.brand.value = product.brand || "";
  form.elements.category.value = product.category || "Retail";
  form.elements.subCategory.value = product.sub_category || "General";
  form.elements.sku.value = product.sku || "";
  form.elements.barcode.value = product.barcode || "";
  form.elements.cost.value = dollars(product.cost_cents);
  form.elements.price.value = dollars(product.price_cents);
  form.elements.specialPrice.value = Number(product.special_price_cents || 0) > 0 ? dollars(product.special_price_cents) : "";
  form.elements.status.value = product.status === "Inactive" ? "Inactive" : "Active";
  document.querySelector("#productFormTitle").textContent = "Edit product";
  document.querySelector("#productSaveButton").textContent = "Update product";
  document.querySelector("#cancelProductEdit").classList.remove("hidden");
  form.scrollIntoView({ behavior:"smooth", block:"start" });
}
function resetProductForm() {
  const form = document.querySelector("#productForm");
  form.reset();
  form.elements.productId.value = "";
  form.elements.cost.value = "0.00";
  document.querySelector("#productFormTitle").textContent = "Add product";
  document.querySelector("#productSaveButton").textContent = "Save product";
  document.querySelector("#cancelProductEdit").classList.add("hidden");
}
async function submitProductForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  const productId = payload.productId;
  try {
    message.textContent = productId ? "Updating product..." : "Adding product...";
    await api(productId ? "/api/products/" + encodeURIComponent(productId) : "/api/products", { method:productId ? "PATCH" : "POST", body:JSON.stringify(payload) });
    resetProductForm();
    await loadData();
    message.textContent = productId ? "Product updated." : "Product added.";
  } catch (error) { message.textContent = error.message; }
}
async function importServicesWorkbook(event) {
  const input=event.currentTarget,file=input.files?.[0];if(!file)return;
  const button=document.querySelector('#importServicesButton'),resultBox=document.querySelector('#serviceImportResult');
  button.disabled=true;
  try{
    if(file.size>5*1024*1024)throw Error('The workbook must be smaller than 5 MB.');
    resultBox.textContent='Importing services...';
    const response=await fetch('/api/services/import',{method:'POST',headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:file});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Service import failed.');
    await loadData();
    resultBox.textContent=result.created+' created · '+result.updated+' updated · '+result.skipped+' skipped'+(result.errors?.length?' — '+result.errors.join(' '):'');
  }catch(error){resultBox.textContent=error.message;}
  finally{input.value='';button.disabled=!userCan('services',true)||!currentUser.allBranches;}
}
async function importProductsWorkbook(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const resultBox = document.querySelector("#productImportResult");
  try {
    message.textContent = "Importing products from " + file.name + "...";
    resultBox.textContent = "Reading workbook...";
    const response = await fetch("/api/products/import", { method:"POST", headers:{ "content-type":file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body:file });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Product import failed.");
    await loadData();
    resultBox.textContent = result.created + " created · " + result.updated + " updated" + (result.skipped ? " · " + result.skipped + " skipped" : "");
    message.textContent = "Product import complete.";
    if (result.errors?.length) resultBox.textContent += " — " + result.errors.join(" ");
  } catch (error) { resultBox.textContent = error.message; message.textContent = error.message; }
  finally { event.currentTarget.value = ""; }
}
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
  if (!canViewTab(tabId)) return;
  document.querySelectorAll(".nav,.tab").forEach((item) => item.classList.remove("active"));
  document.querySelector('.nav[data-tab="' + cssEsc(tabId) + '"]')?.classList.add("active");
  document.querySelector("#" + tabId)?.classList.add("active");
  if (tabId === 'recent-sales') loadRecentSales();
  document.querySelector(".branch-switcher")?.classList.toggle("hidden", tabId !== "overview");
  const titles = { overview:"Dashboard", customers:"Customers", staff:"Staff", roster:"Roster", services:"Services", products:"Products", inventory:"Inventory", reports:"Reports", branches:"Branches", access:"Access", pos:"POS", "receive-products":"Receive products", "staff-clock":"Staff", bookings:"Bookings", closing:"Daily closing", "recent-sales":"Recent sales" };
  if (document.querySelector("#appTitle")) document.querySelector("#appTitle").textContent = appMode === "staff" && selectedPosBranchId ? (state.branch?.name || state.branches[0]?.name || "Kunchas branch") : (currentUser.managerBranchId ? (state.branches[0]?.name || "Branch") + " · " : "") + (titles[tabId] || "Kunchas");
}
function canCheckoutBooking(booking) {
  return !booking.sale_id && booking.payment_status !== "Paid" && !["Cancelled", "No show"].includes(booking.status);
}
function checkoutBookingOption(booking) {
  return '<option value="' + esc(booking.id) + '">' + esc(booking.booking_date + " " + booking.booking_time + " — " + booking.customer_name + " — " + booking.service_names + " — " + money(booking.total_cents)) + '</option>';
}
async function renderBookingCheckoutOptions() {
  const select = document.querySelector("#bookingCheckout");
  const branchId = selectedPosBranchId || currentUser.managerBranchId;
  if (!branchId) { select.innerHTML = '<option value="">New walk-in sale</option>'; return; }
  const search = document.querySelector("#bookingCheckoutSearch").value.trim();
  const requestId = ++checkoutBookingRequest;
  const status = document.querySelector("#bookingCheckoutSearchStatus");
  status.textContent = "Loading bookings…";
  try {
    const result = await api("/api/checkout-bookings?branchId=" + encodeURIComponent(branchId) + "&search=" + encodeURIComponent(search));
    if (requestId !== checkoutBookingRequest || branchId !== (selectedPosBranchId || currentUser.managerBranchId)) return;
    const current = document.querySelector("#saleForm").elements.bookingId.value;
    for (const booking of result.bookings) { const index = state.bookings.findIndex(b => b.id === booking.id); if (index < 0) state.bookings.push(booking); else state.bookings[index] = booking; }
    for (const customer of result.customers) { const index = state.customers.findIndex(c => c.id === customer.id); if (index < 0) state.customers.push(customer); else state.customers[index] = { ...state.customers[index], ...customer }; }
    const options = result.bookings.filter(canCheckoutBooking);
    // Keep an appointment already in the cart selected while searching; never silently change the sale.
    const selected = state.bookings.find(b => b.id === current && canCheckoutBooking(b));
    if (selected && !options.some(b => b.id === current)) options.unshift(selected);
    select.innerHTML = '<option value="">New walk-in sale</option>' + options.map(checkoutBookingOption).join("");
    if (selected) select.value = current;
    status.textContent = result.hasMore ? "Showing 100 matches. Refine your search." : result.bookings.length ? (search ? result.bookings.length + " matching bookings across dates." : "Today’s bookings. Search to find previous dates.") : (search ? "No matching unpaid bookings." : "No unpaid bookings today. Search to find previous dates.");
  } catch (error) { if (requestId === checkoutBookingRequest) status.textContent = error.message; }
}
function loadCheckoutBooking(bookingId) {
  const booking = state.bookings.find(b => b.id === bookingId);
  if (!booking || !canCheckoutBooking(booking)) return;
  const select = document.querySelector("#bookingCheckout");
  if (![...select.options].some(option => option.value === bookingId)) select.insertAdjacentHTML("beforeend", checkoutBookingOption(booking));
  select.value = bookingId;
  selectBookingForCheckout();
}
function selectBookingForCheckout() {
  const form = document.querySelector("#saleForm");
  const booking = state.bookings.find((item) => item.id === document.querySelector("#bookingCheckout").value);
  form.elements.bookingId.value = booking?.id || "";
  form.elements.customerId.value = booking?.customer_id || "";
  if (!booking) {
    form.elements.customerMode.value = "walkin";
    form.elements.customerSearch.value = "";
    updateCustomerMode();
    document.querySelector(".booking-checkout-hint").textContent = "Choose an unpaid booking to preload its customer, services, and assigned staff.";
    document.querySelector("#bookingCustomerCard").classList.add("hidden");
    document.querySelector("#bookingCustomerCard").innerHTML = "";
    return;
  }
  const customer = state.customers.find((item) => item.id === booking.customer_id);
  form.elements.customerMode.value = "existing";
  form.elements.customerSearch.value = customer ? customerLabel(customer) : "";
  updateCustomerMode();
  const customerCard = document.querySelector("#bookingCustomerCard");
  customerCard.innerHTML = '<span>Booking customer</span><strong>' + esc(customer ? customer.first_name + " " + customer.last_name : booking.customer_name || "Customer") + '</strong><em>' + esc(customer?.phone || "No phone") + ' · ' + esc(customer?.email || "No email") + '</em>';
  customerCard.classList.remove("hidden");
  document.querySelector("#saleItems").innerHTML = "";
  parseClientIdList(booking.service_ids).forEach((serviceId) => {
    const service = saleCatalog().find((item) => item.type === "service" && item.id === serviceId);
    if (service) addSaleItem(service, booking.staff_id || "");
  });
  if (!document.querySelector("#saleItems").children.length) addSaleItem();
  resetPaymentUi();
  form.elements.customerMode.value = "existing";
  form.elements.customerId.value = booking.customer_id || "";
  form.elements.customerSearch.value = customer ? customerLabel(customer) : "";
  updateCustomerMode();
  document.querySelector(".booking-checkout-hint").textContent = booking.customer_name + " — " + booking.service_names + " — " + money(booking.total_cents);
  renderCartSummary();
  message.textContent = "Booking loaded. Enter payment to complete checkout.";
}
function checkoutBookingFromRow(event) {
  const bookingId = event.target.closest("tr").dataset.bookingId;
  showTab("pos");
  loadCheckoutBooking(bookingId);
  document.querySelector("#saleForm").scrollIntoView({ behavior:"smooth", block:"start" });
}
function parseClientIdList(value) {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function diaryClock(now = new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:parts.year+'-'+parts.month+'-'+parts.day,minutes:Number(parts.hour)*60+Number(parts.minute)};
}
function updateDiaryClock() {
  const line=document.querySelector('#bookingNowLine');if(!line)return;
  const now=diaryClock();line.hidden=document.querySelector('#bookingDisplayDate').value!==now.date||now.minutes<600||now.minutes>1140;
  line.style.top=((now.minutes-600)*1.2)+'px';
  line.querySelector('span').textContent='Now '+formatBookingTime(now.minutes);
}
setInterval(updateDiaryClock,30000);
function renderBookings() {
  const dateInput=document.querySelector('#bookingDisplayDate');dateInput.value ||= diaryClock().date;
  const dayRows=state.bookings.filter(b=>b.booking_date===dateInput.value&&(!selectedPosBranchId||b.branch_id===selectedPosBranchId));
  const rows=dayRows.filter(b=>!['Cancelled','No show'].includes(b.status)).sort((a,b)=>String(a.booking_time).localeCompare(String(b.booking_time))||String(a.id).localeCompare(String(b.id)));
  const inactive=dayRows.filter(b=>['Cancelled','No show'].includes(b.status));
  const markers=Array.from({length:37},(_,i)=>{const minutes=600+i*15;return '<time class="'+(minutes%60===0?'hour':'quarter')+'" style="top:'+(i*18)+'px">'+formatBookingTime(minutes)+'</time>';}).join('');
  const laneEnds=[0,0,0,0],laneRows=[[],[],[],[]],overflow=[];
  rows.forEach(b=>{const [h,m]=b.booking_time.split(':').map(Number),start=h*60+m,end=start+Math.max(15,Number(b.duration_minutes||15));const lane=laneEnds.findIndex(last=>last<=start);if(lane<0){overflow.push(b);return;}laneEnds[lane]=end;laneRows[lane].push(b);});
  const lanes=laneRows.map((items,index)=>'<div class="booking-staff-lane" aria-label="Booking '+(index+1)+'">'+items.map(b=>{
    const [h,m]=b.booking_time.split(':').map(Number),start=h*60+m,duration=Math.max(15,Number(b.duration_minutes||15)),source=b.source==='Online'?'Online':'Manual';
    const title=b.customer_name+' · '+b.service_names+' · '+formatBookingTime(start)+'–'+formatBookingTime(start+duration)+' · '+b.status;
    return '<button class="booking-card lane-'+index+' '+source.toLowerCase()+'" style="top:'+Math.max(0,(start-600)*1.2)+'px;height:'+Math.max(18,Math.min(duration,1140-start)*1.2)+'px" type="button" title="'+esc(title)+'" aria-label="'+esc(title)+'" data-booking-id="'+esc(b.id)+'"><strong>'+esc(b.customer_name)+'</strong><span class="booking-time">'+formatBookingTime(start)+'–'+formatBookingTime(start+duration)+'</span><span>'+esc(b.service_names)+'</span><span class="booking-meta"><b class="source-badge '+source.toLowerCase()+'">'+source+'</b>'+esc(b.status)+'</span></button>';
  }).join('')+'</div>').join('');
  const history=inactive.length?'<div class="booking-status-history"><h3>Cancelled / no-show bookings</h3>'+inactive.map(b=>'<button type="button" class="secondary booking-history-row" data-booking-id="'+esc(b.id)+'"><span>'+esc(b.booking_time)+' · '+esc(b.customer_name)+' · '+esc(b.service_names)+'</span><strong class="'+(b.status==='No show'?'booking-no-show':'booking-cancelled')+'">'+esc(b.status)+'</strong></button>').join('')+'</div>':'';
  const warning=overflow.length?'<div class="booking-overflow" role="alert">Existing over-capacity bookings need rescheduling: '+overflow.map(b=>'<button class="secondary" data-booking-id="'+esc(b.id)+'">'+esc(b.booking_time+' '+b.customer_name)+'</button>').join('')+'</div>':'';
  document.querySelector('#bookingsTable').innerHTML='<div class="booking-calendar" style="--staff-count:4"><div class="booking-staff-spacer"></div><div class="booking-staff-headers">'+laneRows.map((_,i)=>'<div>Booking '+(i+1)+'</div>').join('')+'</div><div class="booking-time-rail">'+markers+'</div><div class="booking-lanes">'+lanes+'</div><div id="bookingNowLine" class="booking-now" hidden><span></span></div></div>'+(!rows.length?'<p class="hint">No active bookings for this date.</p>':'')+warning+history;
  document.querySelectorAll('#bookingsTable [data-booking-id]').forEach(button=>button.addEventListener('click',()=>openBookingDetail(button.dataset.bookingId)));
  updateDiaryClock();
}
function moveBookingDiaryTo(date) { document.querySelector('#bookingDisplayDate').value=diaryClock(date).date;renderBookings(); }
function moveBookingDiaryBy(days) { const date=new Date((document.querySelector('#bookingDisplayDate').value||diaryClock().date)+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);document.querySelector('#bookingDisplayDate').value=date.toISOString().slice(0,10);renderBookings(); }
function formatBookingTime(totalMinutes) { const hours = Math.floor(totalMinutes / 60); return (hours % 12 || 12) + ':' + String(totalMinutes % 60).padStart(2, '0') + (hours < 12 ? ' am' : ' pm'); }
function bookingTimeSelectOptions(selectedTime) { let options = '<option value="">Select time</option>'; for (let minutes = 600; minutes < 1140; minutes += 15) { const hours = Math.floor(minutes / 60); const value = String(hours).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); options += '<option value="' + value + '"' + (value === selectedTime ? ' selected' : '') + '>' + formatBookingTime(minutes) + '</option>'; } return options; }
function openBookingDetail(bookingId) {
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking) return;
  const customer = state.customers.find((item) => item.id === booking.customer_id);
  const detail = document.querySelector("#bookingDetail");
  const source = booking.source === 'Online' ? 'Online' : 'Manual';
  detail.innerHTML = '<div class="profile-heading"><div><span class="source-badge ' + source.toLowerCase() + '">' + source + '</span><h3>' + esc(booking.customer_name) + '</h3><p class="hint">Edit, reschedule, cancel, or send this booking to POS checkout.</p></div><button class="secondary close-booking-detail" type="button">Close</button></div><div class="booking-detail-grid"><article><span>Phone</span><strong>' + esc(customer?.phone || "Not supplied") + '</strong></article><article><span>Services</span><strong>' + esc(booking.service_names) + '</strong></article><article><span>Staff</span><strong>' + esc(booking.staff_name || "Unassigned") + '</strong></article><article><span>Status</span><strong>' + esc(booking.status) + '</strong></article></div><div class="grid"><label>Booking date<input name="bookingDetailDate" type="date" value="' + esc(booking.booking_date) + '" required></label><label>Booking time<select name="bookingDetailTime" required>' + bookingTimeSelectOptions(booking.booking_time) + '</select></label></div><label>Assigned staff<select name="bookingDetailStaff">' + staffSelectOptions(booking.staff_id) + '</select></label><label>Special note<textarea name="bookingDetailNote">' + esc(booking.notes || "") + '</textarea></label><div class="form-actions booking-edit-actions"><button class="primary save-booking-detail" type="button">Save changes</button>' + (canCheckoutBooking(booking) ? '<button class="secondary checkout-booking-detail" type="button">Checkout in POS</button>' : '') + (!['Cancelled','No show','Completed'].includes(booking.status) ? '<button class="danger cancel-booking-detail" type="button">Cancel booking</button>' : '') + (!['Cancelled','No show','Completed'].includes(booking.status) ? '<button class="secondary no-show-booking-detail" type="button">Mark no show</button>' : '') + '</div>';
  detail.classList.remove("hidden");
  detail.scrollIntoView({ behavior:"smooth", block:"start" });
  detail.querySelector(".close-booking-detail").addEventListener("click", () => detail.classList.add("hidden"));
  detail.querySelector(".save-booking-detail").addEventListener("click", async () => { const bookingDate = detail.querySelector('[name="bookingDetailDate"]').value; const bookingTime = detail.querySelector('[name="bookingDetailTime"]').value; const staffId = detail.querySelector('[name="bookingDetailStaff"]').value; try { const approval=await askActor(booking.branch_id,true,'Authorize booking edit');if(!approval)return;await api('/api/bookings/' + encodeURIComponent(booking.id), { method:'PATCH', body:JSON.stringify({ ...approval, bookingDate, bookingTime, staffId, notes:detail.querySelector('textarea').value }) }); await refreshPosData(); document.querySelector("#bookingDisplayDate").value = bookingDate; renderBookings(); detail.classList.add("hidden"); message.textContent = 'Booking details updated.'; } catch (error) { message.textContent = error.message; } });
  async function changeBookingStatus(status) { try { const approval=await askActor(booking.branch_id,true,status==='No show'?'Mark booking as no show':'Cancel booking');if(!approval)return;await api('/api/bookings/'+encodeURIComponent(booking.id),{method:'PATCH',body:JSON.stringify({...approval,status})});await refreshPosData();detail.classList.add('hidden');message.textContent='Booking marked '+status.toLowerCase()+'.';}catch(error){message.textContent=error.message;} }
  detail.querySelector('.cancel-booking-detail')?.addEventListener('click',()=>changeBookingStatus('Cancelled'));
  detail.querySelector('.no-show-booking-detail')?.addEventListener('click',()=>changeBookingStatus('No show'));
  detail.querySelector(".checkout-booking-detail")?.addEventListener("click", () => { loadCheckoutBooking(booking.id); showTab("pos"); });
}
function localSalesDate() { const now=new Date();return now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0'); }
async function loadRecentSales() {
  const dateInput=document.querySelector('#recentSalesDate');dateInput.value ||= localSalesDate();
  const requestId=++recentSalesRequest;
  recentSales=[];recentSalesLoading=true;renderSales();
  if(!selectedPosBranchId){recentSalesLoading=false;renderSales();return;}
  try {
    const from=new Date(dateInput.value+'T00:00:00');const to=new Date(from);to.setDate(to.getDate()+1);
    const result=await api('/api/recent-sales?from='+encodeURIComponent(from.toISOString())+'&to='+encodeURIComponent(to.toISOString()),{headers:{'x-branch-id':selectedPosBranchId}});
    if(requestId!==recentSalesRequest)return;
    recentSales=result.sales;
    const ids=new Set(recentSales.map(sale=>sale.id));state.sales=state.sales.filter(sale=>!ids.has(sale.id)).concat(recentSales);
    recentSalesLoading=false;renderSales();
  } catch(error) {if(requestId===recentSalesRequest){recentSalesLoading=false;renderSales();document.querySelector('#recentSalesStatus').textContent=error.message;}}
}
function renderSales() {
  const query=document.querySelector('#recentSalesSearch').value.trim().toLowerCase();
  const sales=recentSales.filter(sale=>sale.branch_id===selectedPosBranchId && (!query||[sale.customer_name||'Walking customer',sale.customer_phone,sale.customer_email].some(value=>String(value||'').toLowerCase().includes(query))));
  document.querySelector('#recentSalesStatus').textContent=recentSalesLoading?'Loading sales…':sales.length+' sales for the selected day'+(query?' matching your customer search':'');
  document.querySelector('#salesTable').innerHTML=recentSalesLoading?'<tr><td colspan="7">Loading sales…</td></tr>':sales.length?sales.map(s=>'<tr><td>'+esc(new Date(s.created_at).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}))+'</td><td>'+esc(s.customer_name||'Walking customer')+'</td><td>'+money(s.total_cents)+'</td><td>'+esc(s.payment_method)+'</td><td>'+esc(s.status)+'</td><td>'+esc(s.recorded_by_name||'Not recorded')+'</td><td><button type="button" class="secondary" aria-label="Edit sale" title="Manager PIN and reason required" data-edit-sale="'+esc(s.id)+'">&#9998;</button></td></tr>').join(''):'<tr><td colspan="7">No sales found for this date and customer search.</td></tr>';
  document.querySelectorAll('[data-edit-sale]').forEach(button=>button.addEventListener('click',()=>openSaleEditor(button.dataset.editSale)));
}
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
function renderReceivedProducts() {
  const stockBody = document.querySelector("#receiveProductsStock");
  const historyBody = document.querySelector("#receiveProductsHistory");
  if (!stockBody || !historyBody) return;
  const branchId = selectedPosBranchId || state.branch?.id || "";
  const stock = new Map((state.inventoryStock || []).filter((row) => !branchId || row.branch_id === branchId).map((row) => [row.product_id, Number(row.quantity || 0)]));
  const products = (state.products || []).filter((product) => product.status !== "Inactive");
  stockBody.innerHTML = products.length ? products.map((product) => '<tr><td><strong>' + esc(product.name) + '</strong></td><td>' + esc(product.sku || "—") + '</td><td><strong class="stock-quantity">' + (stock.get(product.id) || 0) + '</strong></td></tr>').join("") : '<tr><td colspan="3" class="empty-cell">No active products are available to receive.</td></tr>';
  const receipts = (state.stockMovements || []).filter((movement) => movement.movement_type === "Receive" && (!branchId || movement.branch_id === branchId));
  historyBody.innerHTML = receipts.length ? receipts.map((movement) => '<tr><td>' + esc(new Date(movement.created_at).toLocaleString("en-AU", { dateStyle:"medium", timeStyle:"short" })) + '</td><td><strong>' + esc(movement.product_name || "Product") + '</strong></td><td><strong>+' + Number(movement.quantity_delta || 0) + '</strong></td><td>' + esc(movement.reference || "—") + '</td><td>' + esc(movement.reason || "—") + '</td></tr>').join("") : '<tr><td colspan="5" class="empty-cell">No product deliveries have been recorded for this branch.</td></tr>';
}
async function submitReceivedProducts(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const status = document.querySelector("#receiveProductsMessage");
  const values = Object.fromEntries(new FormData(form));
  if (!values.productId || !Number.isSafeInteger(Number(values.quantity)) || Number(values.quantity) < 1) { status.textContent = "Choose a product and enter a positive whole quantity."; return; }
  button.disabled = true;
  status.textContent = "";
  try {
    const actor = await askActor(selectedPosBranchId, false, "Confirm product receipt with your PIN");
    if (!actor) return;
    const productName = state.products.find((product) => product.id === values.productId)?.name || "product";
    await api("/api/stock-movements", { method:"POST", body:JSON.stringify({ ...values, ...actor, branchId:selectedPosBranchId, movementType:"Receive", quantity:Number(values.quantity) }) });
    form.reset();
    form.elements.branchId.value = selectedPosBranchId;
    form.elements.movementType.value = "Receive";
    await refreshPosData();
    status.textContent = Number(values.quantity) + " × " + productName + " received into branch stock.";
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
}
function renderClosings() {
  document.querySelector("#closingTable").innerHTML = (state.dailyClosings || []).map((c) => '<tr><td>' + esc(c.closing_date) + '<div class="hint">Closed by '+esc(c.closed_by||'Not recorded')+'</div></td><td>' + esc(c.branch_name) + '<div class="hint">Yesterday ' + money(c.previous_cash_cents || 0) + '</div></td><td>' + money(c.cash_taken_cents || 0) + '</td><td>' + money(c.remaining_cash_cents ?? c.actual_cash_cents) + '<div class="hint">Variance ' + money(c.cash_variance_cents) + '</div></td><td><span class="pill">' + esc(c.status) + '</span></td></tr>').join("");
  document.querySelector("#adminClosingTable").innerHTML = (state.dailyClosings || []).map((c) => '<tr data-closing-id="' + esc(c.id) + '"><td>' + esc(c.closing_date) + '</td><td>' + esc(c.branch_name) + '<div class="hint">Yesterday ' + money(c.previous_cash_cents || 0) + ' / sales cash ' + money(c.expected_cash_cents) + ' / card ' + money(c.expected_card_cents) + '</div></td><td><input name="actualCash" type="number" min="0" step="0.01" value="' + dollars(c.actual_cash_cents) + '"><div class="hint">Variance ' + money(c.cash_variance_cents) + '</div></td><td><input name="cashTaken" type="number" min="0" step="0.01" value="' + dollars(c.cash_taken_cents || 0) + '"><div class="hint">Remaining ' + money(c.remaining_cash_cents ?? c.actual_cash_cents) + '</div></td><td><input name="actualCard" type="number" min="0" step="0.01" value="' + dollars(c.actual_card_cents) + '"><div class="hint">Variance ' + money(c.card_variance_cents) + '</div></td><td><select name="status"><option' + selected(c.status, "Balanced") + '>Balanced</option><option' + selected(c.status, "Variance") + '>Variance</option><option' + selected(c.status, "Manager Review") + '>Manager Review</option><option' + selected(c.status, "Approved") + '>Approved</option></select></td><td><input name="approvedBy" value="' + esc(c.approved_by || "") + '" placeholder="Manager"><textarea name="notes" placeholder="Notes">' + esc(c.notes || "") + '</textarea></td><td><button class="secondary save-closing" type="button">Save</button></td></tr>').join("");
  document.querySelectorAll(".save-closing").forEach((button) => button.addEventListener("click", saveClosingRow));
}
function reportQuery() {
  return new URLSearchParams({ from:document.querySelector("#reportFrom").value, to:document.querySelector("#reportTo").value, branchId:document.querySelector("#reportBranch").value }).toString();
}
async function loadReports() {
  if (appMode !== "admin" || (!userCan("reports") && !userCan("payroll"))) return;
  const requestId = ++reportRequestId;
  const query = reportQuery();
  try {
    document.querySelector("#reportMetrics").innerHTML = '<article><span>Reports</span><strong>Loading…</strong></article>';
    const result = await api("/api/reports?" + query);
    if (requestId !== reportRequestId) return;
    reportData = result;
    renderReports();
    applyAccessUi();
  } catch (error) { if (requestId === reportRequestId) message.textContent = error.message; }
}
function reportEmpty(cols, label = "No records for this period.") { return '<tr><td colspan="' + cols + '" class="empty-cell">' + esc(label) + '</td></tr>'; }
function reportTime(value) { return value ? new Date(value).toLocaleString("en-AU", { day:"2-digit", month:"short", hour:"numeric", minute:"2-digit" }) : "—"; }
function renderReports() {
  if (!reportData) return;
  const summary = reportData.summary || {};
  document.querySelector("#reportStaffDailyTable").innerHTML = reportData.staffDailyRows?.length ? reportData.staffDailyRows.map((row) => '<tr><td>' + esc(row.date) + '</td><td><strong>' + esc(row.staff) + '</strong></td><td>' + esc(row.role) + '</td><td>' + esc(row.branch) + '</td><td><strong>' + money(row.creditedSalesCents) + '</strong></td><td>' + row.serviceItems + '</td><td>' + row.transactions + '</td></tr>').join("") : reportEmpty(7, "No staff sales for this period.");
  document.querySelector("#reportManagerDailyTable").innerHTML = reportData.managerDailyRows?.length ? reportData.managerDailyRows.map((row) => '<tr><td>' + esc(row.date) + '</td><td><strong>' + esc(row.manager) + '</strong></td><td>' + esc(row.branch) + '</td><td><strong>' + money(row.revenueCents) + '</strong></td><td>' + row.transactions + '</td></tr>').join("") : reportEmpty(5, "No manager roster assignments for this period.");
  document.querySelector("#reportBranchDailyTable").innerHTML = reportData.branchDailyRows?.length ? reportData.branchDailyRows.map((row) => '<tr><td>' + esc(row.date) + '</td><td><strong>' + esc(row.branch) + '</strong></td><td><strong>' + money(row.revenueCents) + '</strong></td><td>' + row.transactions + '</td><td>' + row.productsSold + '</td><td>' + row.servicesSold + '</td></tr>').join("") : reportEmpty(6, "No branch sales for this period.");
  document.querySelector("#reportMetrics").innerHTML = [["Total sales", money(summary.revenueCents)], ["Transactions", summary.transactions || 0], ["Products sold", summary.productsSold || 0], ["Services sold", summary.servicesSold || 0], ["Online bookings", summary.onlineBookings || 0], ["Walk-ins", summary.walkIns || 0], ["Worked hours", Number(summary.workedHours || 0).toFixed(2)]].map(([label, value]) => '<article><span>' + label + '</span><strong>' + value + '</strong></article>').join("");
  document.querySelector("#reportBranchTable").innerHTML = reportData.branchRows.length ? reportData.branchRows.map((row) => '<tr><td><strong>' + esc(row.branch) + '</strong></td><td><strong>' + money(row.revenueCents) + '</strong></td><td>' + row.transactions + '</td><td>' + row.productsSold + '</td><td>' + row.servicesSold + '</td><td>' + row.onlineBookings + '</td><td>' + row.manualBookings + '</td><td>' + row.walkIns + '</td></tr>').join("") : reportEmpty(8);
  document.querySelector("#reportStaffTable").innerHTML = reportData.staffRows.length ? reportData.staffRows.map((row) => '<tr><td><strong>' + esc(row.staff) + '</strong></td><td>' + esc(row.role) + '</td><td>' + money(row.creditedSalesCents) + '</td><td>' + row.serviceItems + '</td><td><strong>' + money(row.managerStoreSalesCents) + '</strong></td></tr>').join("") : reportEmpty(5);
  document.querySelector("#reportProductsTable").innerHTML = reportData.productRows.length ? reportData.productRows.map((row) => '<tr><td><strong>' + esc(row.name) + '</strong></td><td>' + row.quantity + '</td><td>' + money(row.revenueCents) + '</td></tr>').join("") : reportEmpty(3, "No products sold.");
  document.querySelector("#reportServicesTable").innerHTML = reportData.serviceRows.length ? reportData.serviceRows.map((row) => '<tr><td><strong>' + esc(row.name) + '</strong></td><td>' + row.quantity + '</td><td>' + money(row.revenueCents) + '</td></tr>').join("") : reportEmpty(3, "No services sold.");
  document.querySelector("#reportBookingsTable").innerHTML = reportData.bookingRows.length ? reportData.bookingRows.map((row) => '<tr><td><strong>' + esc(row.branch) + '</strong></td><td><span class="source-pill">' + esc(row.source) + '</span></td><td>' + row.count + '</td><td>' + money(row.valueCents) + '</td><td>' + row.completed + '</td></tr>').join("") : reportEmpty(5);
  document.querySelector("#reportPayrollTable").innerHTML = reportData.payrollRows.length ? reportData.payrollRows.map((row) => '<tr><td>' + esc(row.date) + '</td><td><strong>' + esc(row.staff) + '</strong><span class="table-subtext">' + esc(row.role) + '</span></td><td>' + esc(row.branch) + '</td><td>' + esc(reportTime(row.clockIn)) + '</td><td>' + Number(row.breakMinutes || 0) + ' min</td><td>' + esc(reportTime(row.clockOut)) + '</td><td><strong>' + Number(row.hours || 0).toFixed(2) + '</strong></td><td>' + '<span class="status-pill ' + (row.status === "Complete" ? "" : "inactive") + '">' + esc(row.status) + '</span></td></tr>').join("") : reportEmpty(8, "No clock-in records for this period.");
  const exportQuery = new URLSearchParams(reportData.range).toString();
  document.querySelectorAll(".report-export").forEach((link) => { link.href = "/api/reports/export?type=" + encodeURIComponent(link.dataset.reportType) + "&" + exportQuery; });
}
function addSaleItem(selectedItem = null, selectedStaffId = "") {
  const row = document.createElement("div");
  row.className = "sale-item";
  row.innerHTML = '<label>Quick find service / product<input name="saleItemSearch" list="itemList" autocomplete="off" required placeholder="Type at least 2 letters"></label><p class="hint quick-find-hint">Suggestions appear after 2 letters, ranked by closest match.</p><div class="line-meta"></div><div class="instance-edit hidden"><div class="grid"><label>Name for this sale<input name="instanceName"></label><label>Amount for this sale $<input name="instancePrice" type="number" min="0.01" step="0.01"></label></div><p class="hint">Only this sale and receipt change. The master service stays the same.</p></div><div class="staff-area"><span class="field-label">Staff involved</span><div class="staff-add-row"><input name="saleStaffSearch" list="staffList" placeholder="Type staff name, phone, or email"><button class="secondary add-staff" type="button">Add</button></div><div class="selected-staff"></div><p class="hint allocation-summary">Staff percentages: 0% · Staff dollars: $0.00</p></div>';
  document.querySelector("#saleItems").append(row);
  row.querySelector(".add-staff").addEventListener("click", () => addStaffToSaleItem(row));
  const quickFind = row.querySelector('input[name="saleItemSearch"]');
  quickFind.addEventListener("input", () => { updateSaleQuickFind(quickFind.value); updateSaleItemRow(row); });
  quickFind.addEventListener("focus", () => updateSaleQuickFind(quickFind.value));
  row.querySelector('input[name="instanceName"]').addEventListener("input", renderCartSummary);
  row.querySelector('input[name="instancePrice"]').addEventListener("input", () => { rebalanceStaffAllocations(row, null, "preserve"); renderCartSummary(); });
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
function toggleBookingServiceMenu() { const menu = document.querySelector("#bookingServiceMenu"); const opening = menu.classList.contains("hidden"); menu.classList.toggle("hidden", !opening); document.querySelector("#bookingServiceSearch").setAttribute("aria-expanded", String(opening)); if (opening) renderBookingServiceCategories(); }
function availableBookingServices() { return state.services.filter((service) => service.status !== "Inactive"); }
function renderBookingServiceCategories() {
  const categories = [...new Set(availableBookingServices().map((service) => service.category || "General"))].sort(serviceCategoryDisplayCompare);
  document.querySelector("#bookingServiceCategories").innerHTML = '<p class="booking-picker-title">Choose a category</p>' + categories.map((category) => '<button class="booking-category-option" type="button" data-category="' + esc(category) + '">' + esc(category) + '</button>').join("");
  document.querySelector("#bookingCategoryServices").classList.add("hidden");
  document.querySelectorAll(".booking-category-option").forEach((button) => button.addEventListener("click", () => renderBookingSubCategories(button.dataset.category)));
}
function renderBookingSubCategories(category) {
  const subCategories = [...new Set(availableBookingServices().filter((service) => (service.category || "General") === category).map((service) => service.sub_category || "General"))].sort();
  const box = document.querySelector("#bookingCategoryServices");
  box.innerHTML = '<div class="booking-picker-heading"><button class="secondary booking-category-back" type="button">Categories</button><strong>' + esc(category) + '</strong></div><p class="booking-picker-title">Choose a sub-category</p><div class="booking-service-categories">' + subCategories.map((subCategory) => '<button class="booking-category-option" type="button" data-sub-category="' + esc(subCategory) + '">' + esc(subCategory) + '</button>').join('') + '</div>';
  box.classList.remove("hidden");
  box.querySelector(".booking-category-back").addEventListener("click", renderBookingServiceCategories);
  box.querySelectorAll("[data-sub-category]").forEach((button) => button.addEventListener("click", () => renderBookingCategoryServices(category, button.dataset.subCategory)));
}
function renderBookingCategoryServices(category, subCategory) {
  const services = availableBookingServices().filter((service) => (service.category || "General") === category && (service.sub_category || "General") === subCategory);
  const box = document.querySelector("#bookingCategoryServices");
  box.innerHTML = '<div class="booking-picker-heading"><button class="secondary booking-category-back" type="button">Sub-categories</button><strong>' + esc(category) + ' · ' + esc(subCategory) + '</strong></div>' + services.map((service) => '<button class="booking-service-option" type="button" data-service-id="' + esc(service.id) + '"><span><strong>' + esc(service.name) + '</strong><em>' + esc(service.duration_minutes + ' min') + '</em></span><b>' + money(service.price_cents) + '</b></button>').join('');
  box.classList.remove("hidden");
  box.querySelector(".booking-category-back").addEventListener("click", () => renderBookingSubCategories(category));
  box.querySelectorAll(".booking-service-option").forEach((button) => button.addEventListener("click", () => addBookingService(button.dataset.serviceId)));
}
function addBookingService(serviceId) {
  const service = availableBookingServices().find((item) => item.id === serviceId);
  if (!service || document.querySelector('#bookingSelectedServices input[value="' + cssEsc(service.id) + '"]')) return;
  const row = document.createElement("div");
  row.className = "booking-service-row";
  row.innerHTML = '<input type="hidden" name="serviceIds" value="' + esc(service.id) + '"><span><strong>' + esc(service.name) + '</strong><em>' + esc(service.category) + ' · ' + esc(service.sub_category || "General") + '</em></span><b>' + money(service.price_cents) + '</b><button type="button" aria-label="Remove ' + esc(service.name) + '">×</button>';
  row.querySelector("button").addEventListener("click", () => { row.remove(); renderBookingServiceTotal(); });
  document.querySelector("#bookingSelectedServices").append(row);
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
  const form = event.target;
  const submitButton = document.querySelector("#completeSale");
  const data = new FormData(form);
  setSaleMessage("");
  const customerMode = data.get("customerMode");
  const selectedBooking = state.bookings.find((booking) => booking.id === data.get("bookingId"));
  const customerId = selectedBooking?.customer_id || (customerMode === "existing" ? findCustomerId(data.get("customerSearch")) : "");
  if (customerMode === "existing" && !customerId) {
    setSaleMessage("Select an existing customer from the dropdown, or choose walking customer.", true);
    return;
  }
  if (customerMode === "new" && (!data.get("newFirstName") || !data.get("newLastName") || (!data.get("newPhone") && !data.get("newEmail")))) {
    setSaleMessage("New customer needs first name, last name, and phone or email.", true);
    return;
  }
  const saleRows = [...form.querySelectorAll(".sale-item")];
  const items = saleRows.map((row) => {
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
  if (!items.length || items.length !== saleRows.length) {
    setSaleMessage("Select a valid service or product for every sale item.", true);
    return;
  }
  if (saleRows.some((row) => {
    const item = findSaleItem(row.querySelector('input[name="saleItemSearch"]').value);
    return item?.type === "service" && (!row.querySelector('input[name="instanceName"]').value.trim() || Number(row.querySelector('input[name="instancePrice"]').value) <= 0);
  })) {
    setSaleMessage("Each service needs a name and an amount greater than $0.00.", true);
    return;
  }
  for (const row of saleRows) {
    const error = allocationError(row);
    if (error) { setSaleMessage(error, true); return; }
  }
  const saleTotal = saleRows.reduce((total, row) => {
    const item = findSaleItem(row.querySelector('input[name="saleItemSearch"]').value);
    const amount = item.type === "service" ? Math.round(Number(row.querySelector('input[name="instancePrice"]').value) * 100) : item.priceCents;
    return total + amount;
  }, 0);
  const paidCents = salePayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const cashCents = salePayments.filter((payment) => payment.method === "Cash").reduce((sum, payment) => sum + payment.amountCents, 0);
  if (!salePayments.length || paidCents < saleTotal) {
    setSaleMessage("Add another payment for the remaining " + money(Math.max(0, saleTotal - paidCents)) + ".", true);
    return;
  }
  if (paidCents - saleTotal > cashCents) {
    setSaleMessage("Only cash can exceed the sale total and produce change.", true);
    return;
  }
  let actor;try{actor=await askActor(data.get("branchId"),false,"Complete payment — enter staff PIN",false,false,true);}catch(error){setSaleMessage(error.message,true);return;}if(!actor)return;
  submitButton.disabled = true;
  submitButton.textContent = "Processing payment...";
  await submitJson("/api/sales", {
    ...actor,
    branchId:data.get("branchId"),
    bookingId:data.get("bookingId"),
    customerMode,
    customerId,
    customerCategory:data.get("customerCategory"),
    newCustomer:{ firstName:data.get("newFirstName"), lastName:data.get("newLastName"), phone:data.get("newPhone"), email:data.get("newEmail") },
    payments:salePayments.map((payment) => ({ method:payment.method, amount:(payment.amountCents / 100).toFixed(2) })),
    items
  }, form);
  submitButton.disabled = false;
  submitButton.textContent = "Complete payment";
}
function setSaleMessage(text, isError = false) {
  const saleMessage = document.querySelector("#saleMessage");
  if (!saleMessage) return;
  saleMessage.textContent = text;
  saleMessage.classList.toggle("error", isError);
}
async function submitJson(path, payload, form) {
  try {
    message.textContent = "Saving...";
    if (form.id === "saleForm") setSaleMessage("Processing purchase...");
    const result = await api(path, { method:"POST", body:JSON.stringify(payload) });
    if (result.receipt) {
      lastReceipt = result.receipt;
      try { sessionStorage.setItem("kunchasLastReceipt", JSON.stringify(lastReceipt)); } catch {}
      syncLastReceiptButton();
    }
    form.reset();
    if (form.id === "saleForm") { document.querySelector("#saleItems").innerHTML = ""; document.querySelector("#bookingCheckout").value = ""; document.querySelector("#bookingCustomerCard").classList.add("hidden"); document.querySelector("#bookingCustomerCard").innerHTML = ""; addSaleItem(); updateCustomerMode(); resetPaymentUi(); setSaleMessage(result.receipt?.changeCents ? "Purchase complete. Return " + money(result.receipt.changeCents) + " change." : "Purchase completed successfully."); if (result.receipt) showCheckoutReceiptPrompt(result.receipt); }
    if (form.id === "bookingForm") { document.querySelector("#bookingSelectedServices").innerHTML = ""; renderBookingServiceTotal(); }
    if (path === "/api/sales" || path === "/api/branch-bookings" || path === "/api/daily-closing") await refreshPosData();
    else await loadData();
  } catch (error) { message.textContent = error.message; if (form.id === "saleForm") setSaleMessage(error.message, true); }
}
function updateCustomerMode() {
  const mode = document.querySelector('select[name="customerMode"]').value;
  document.querySelector(".customer-existing").classList.toggle("hidden", mode !== "existing");
  document.querySelector(".customer-new").classList.toggle("hidden", mode !== "new");
}
async function saveBookingRow(event) {
  const row = event.target.closest("tr");
  const booking=state.bookings.find(b=>b.id===row.dataset.bookingId);const actor=await askActor(booking.branch_id,true,"Authorize booking edit");if(!actor)return;
  await api("/api/bookings/" + row.dataset.bookingId, { method:"PATCH", body:JSON.stringify({...actor, bookingDate:row.querySelector('input[name="bookingDate"]').value, bookingTime:row.querySelector('input[name="bookingTime"]').value, staffId:row.querySelector('select[name="staffId"]').value, status:row.querySelector('select[name="status"]').value }) });
  message.textContent = "Booking updated.";
  await refreshPosData();
}
async function saveClosingRow(event) {
  const row = event.target.closest("tr");
  const closing=state.dailyClosings.find(c=>c.id===row.dataset.closingId);const actor=await askActor(closing.branch_id,true,"Authorize closing edit");if(!actor)return;
  await api("/api/daily-closing/" + row.dataset.closingId, { method:"PATCH", body:JSON.stringify({...actor, actualCash:row.querySelector('input[name="actualCash"]').value, cashTaken:row.querySelector('input[name="cashTaken"]').value, actualCard:row.querySelector('input[name="actualCard"]').value, status:row.querySelector('select[name="status"]').value, approvedBy:row.querySelector('input[name="approvedBy"]').value, notes:row.querySelector('textarea[name="notes"]').value }) });
  message.textContent = "Daily closing updated.";
  await loadData();
}
document.querySelectorAll("[data-denomination]").forEach(input=>input.addEventListener("input",renderClosingPreview));
function renderClosingPreview() {
  const expectedBox = document.querySelector("#closingExpected");
  const varianceBox = document.querySelector("#closingVariance");
  if (!expectedBox || !varianceBox) return;
  const form = document.querySelector("#closingForm");
  const closingDate = form.querySelector('input[name="closingDate"]').value;
  const requestedKey = selectedPosBranchId + ':' + closingDate;
  if (selectedPosBranchId && closingDate && closingSalesKey !== requestedKey) {
    closingSalesKey = requestedKey;
    closingSalesLoading = true;
    const requestId = ++closingSalesRequest;
    api('/api/closing-sales?date=' + encodeURIComponent(closingDate),{headers:{'x-branch-id':selectedPosBranchId}}).then((result)=>{
      if (requestId !== closingSalesRequest) return;
      state.sales = state.sales.filter((sale)=>!(sale.branch_id===selectedPosBranchId && String(sale.created_at||'').slice(0,10)===closingDate)).concat(result.sales);
      state.cashDrawerOpens = state.cashDrawerOpens.filter((entry)=>!(entry.branch_id===selectedPosBranchId && String(entry.opened_at||'').slice(0,10)===closingDate)).concat(result.drawerOpens || []);
      closingSalesLoading = false;
      renderClosingPreview();
    }).catch((error)=>{ if(requestId===closingSalesRequest){ message.textContent=error.message; document.querySelector('#closingSalesTable').innerHTML='<tr><td colspan="6">Could not load sales. Reopen the branch to retry.</td></tr>'; } });
  }
  form.querySelector('[type="submit"]').disabled = closingSalesLoading;
  const totals = expectedClosingPreview(closingDate);
  const previousCash = previousClosingCashPreview(closingDate);
  const openingFloat = Math.round(Number(form.querySelector('input[name="openingFloat"]').value || 0) * 100);
  const actualCash = [...form.querySelectorAll("[data-denomination]")].reduce((sum,input)=>sum+Number(input.dataset.denomination)*100*Number(input.value||0),0);
  form.elements.actualCash.value=dollars(actualCash);
  const cashTaken = Math.round(Number(form.querySelector('input[name="cashTaken"]').value || 0) * 100);
  const remainingCash = Math.max(0, actualCash - cashTaken);
  const actualCard = Math.round(Number(form.querySelector('input[name="actualCard"]').value || 0) * 100);
  form.querySelector('input[name="previousCash"]').value = dollars(previousCash);
  form.querySelector('input[name="remainingCash"]').value = dollars(remainingCash);
  const expectedDrawerCash = previousCash + openingFloat + totals.cashCents;
  const daySales = state.sales.filter((sale) => sale.branch_id === selectedPosBranchId && String(sale.created_at || '').slice(0,10) === closingDate);
  const extraMethods = ['Bank Transfer','Store Credit','Refund','Gift Voucher','On Account'].map((method) => {
    const amount = daySales.reduce((sum,sale) => sum + String(sale.payment_method || '').split(' / ').reduce((partTotal,part) => {
      const parts = part.split('$');
      return partTotal + (parts[0].trim().toLowerCase() === method.toLowerCase() ? Math.round(Number((parts[1] || '').split(',').join('')) * 100) || 0 : 0);
    },0),0);
    return {method,amount};
  }).filter((entry) => entry.amount !== 0);
  document.querySelector('#closingDateTitle').textContent = closingDate ? new Date(closingDate + 'T12:00:00').toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) : '';
  const columns = [['Branch',esc(branchName(selectedPosBranchId))],['Card',money(totals.cardCents)],['Float start',money(previousCash + openingFloat)],['Cash sales',money(totals.cashCents)],['Float end',money(remainingCash)],...extraMethods.map((entry)=>[entry.method,money(entry.amount)]),['Sales total',money(daySales.reduce((sum,sale)=>sum+Number(sale.total_cents||0),0))]];
  expectedBox.innerHTML = '<table class="closing-overview"><thead><tr>' + columns.map(([label])=>'<th>'+label+'</th>').join('') + '</tr></thead><tbody><tr>' + columns.map(([,value])=>'<td><strong>'+value+'</strong></td>').join('') + '</tr></tbody></table>';
  document.querySelector('#closingSalesCount').textContent = daySales.length + ' sales';
  document.querySelector('#closingSalesTable').innerHTML = daySales.length ? daySales.map((sale)=>'<tr><td>'+esc(new Date(sale.created_at).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'}))+'</td><td>'+esc(sale.id)+'</td><td>'+esc(sale.payment_method)+'</td><td>'+money(sale.total_cents)+'</td><td>'+esc(sale.recorded_by_name||'Not recorded')+'</td><td><button type="button" class="closing-sale-edit" aria-label="Edit sale" title="Manager PIN and reason required" data-closing-edit="'+esc(sale.id)+'"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg></button></td></tr>').join('') : '<tr><td colspan="6" class="empty-cell">No sales for this day.</td></tr>';
  document.querySelectorAll('[data-closing-edit]').forEach((button)=>button.addEventListener('click',()=>openSaleEditor(button.dataset.closingEdit)));
  renderCashDrawerHistory();
  const cashVariance = actualCash - expectedDrawerCash;
  const cardVariance = actualCard - totals.cardCents;
  varianceBox.innerHTML = '<article><span>Cash difference</span><strong>' + money(cashVariance) + '</strong></article><article><span>Card difference</span><strong>' + money(cardVariance) + '</strong></article><article class="' + (cashVariance || cardVariance ? 'closing-unbalanced' : 'closing-balanced') + '" role="status"><span>Status</span><strong>' + (cashVariance || cardVariance ? 'Not balanced' : 'Balanced') + '</strong></article>';
}
function renderCashDrawerHistory() {
  const body = document.querySelector("#cashDrawerHistoryTable");
  if (!body) return;
  const closingDate = document.querySelector('#closingForm input[name="closingDate"]').value;
  const entries = (state.cashDrawerOpens || []).filter((entry) => entry.branch_id === selectedPosBranchId && (!closingDate || String(entry.opened_at || "").slice(0,10) === closingDate));
  body.innerHTML = entries.length ? entries.map((entry) => '<tr><td>' + esc(new Date(entry.opened_at).toLocaleString("en-AU")) + '</td><td>' + esc(entry.actor_name || "Not recorded") + '</td><td>' + esc(entry.source === "daily_closing" ? "Daily closing" : "Checkout") + '</td><td>' + esc(entry.reason || (entry.source === "daily_closing" ? "Not required" : "")) + '</td></tr>').join("") : '<tr><td colspan="4" class="empty-cell">No cash drawer openings recorded for this date.</td></tr>';
}
function previousClosingCashPreview(date) {
  const branchId = selectedPosBranchId || document.querySelector('#closingForm input[name="branchId"]')?.value || "";
  const previous = (state.dailyClosings || [])
    .filter((closing) => (!branchId || closing.branch_id === branchId) && (!date || String(closing.closing_date || "") < date))
    .sort((a, b) => String(b.closing_date || "").localeCompare(String(a.closing_date || "")))[0];
  return Number(previous?.remaining_cash_cents ?? previous?.actual_cash_cents ?? 0);
}
function expectedClosingPreview(date) {
  return state.sales.filter((sale) => sale.status === 'Paid' && (!selectedPosBranchId || sale.branch_id === selectedPosBranchId) && (!date || String(sale.created_at || "").slice(0, 10) === date)).reduce((totals, sale) => {
    if (sale.cash_cents != null && sale.card_cents != null) { totals.cashCents += Number(sale.cash_cents) - Number(sale.change_cents || 0); totals.cardCents += Number(sale.card_cents); totals.count += 1; return totals; }
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
  const total = selectedItems.reduce((sum, item) => sum + item.priceCents, 0);
  document.querySelector("#cartTotal").textContent = money(total);
  document.querySelector("#checkoutTotal").textContent = money(total);
  const panel = document.querySelector("#paymentPanel");
  if (salePayments.length && paymentTotalSnapshot !== total) {
    resetPaymentUi();
    setSaleMessage("The sale total changed. Add the payment amounts again.");
  } else if (panel && !panel.classList.contains("hidden") && !salePayments.length) {
    paymentTotalSnapshot = total;
    document.querySelector('#saleForm input[name="paymentAmount"]').value = dollars(total);
    renderPaymentState(false);
  }
}
function saleTotalCents() {
  return [...document.querySelectorAll(".sale-item")].reduce((total, row) => {
    const item = findSaleItem(row.querySelector('input[name="saleItemSearch"]')?.value);
    if (!item) return total;
    return total + (item.type === "service" ? Math.round(Number(row.querySelector('input[name="instancePrice"]').value || 0) * 100) : item.priceCents);
  }, 0);
}
function resetPaymentUi() {
  const form = document.querySelector("#saleForm");
  if (!form) return;
  salePayments = [];
  paymentTotalSnapshot = saleTotalCents();
  form.elements.paymentAmount.value = "";
  document.querySelector("#paymentPanel").classList.add("hidden");
  document.querySelector("#showPaymentMethods").classList.remove("hidden");
  document.querySelector("#completeSale").classList.add("hidden");
  document.querySelector("#completeSale").disabled = true;
  document.querySelector("#selectedPaymentMethod").textContent = "Enter an amount, then choose how it was paid.";
  document.querySelector("#paymentAllocations").innerHTML = "";
  document.querySelector("#paymentBalance").innerHTML = "";
  document.querySelector("#cartPaymentSummary").innerHTML = "";
}
function showPaymentMethods() {
  const total = saleTotalCents();
  if (!total) { setSaleMessage("Add a valid service or product before paying.", true); return; }
  setSaleMessage("");
  salePayments = [];
  paymentTotalSnapshot = total;
  document.querySelector("#paymentPanel").classList.remove("hidden");
  document.querySelector("#showPaymentMethods").classList.add("hidden");
  document.querySelector("#completeSale").classList.remove("hidden");
  document.querySelector('#saleForm input[name="paymentAmount"]').value = dollars(total);
  renderPaymentState(false);
  document.querySelector("#paymentPanel").scrollIntoView({ behavior:"smooth", block:"nearest" });
}
function paymentTotals() {
  const total = saleTotalCents();
  const paid = salePayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const cash = salePayments.filter((payment) => payment.method === "Cash").reduce((sum, payment) => sum + payment.amountCents, 0);
  return { total, paid, cash, remaining:Math.max(0, total - paid), change:Math.max(0, paid - total) };
}
function renderPaymentState(syncInput = true) {
  const totals = paymentTotals();
  const allocationHtml = salePayments.map((payment, index) => '<div class="payment-allocation"><span><strong>' + esc(payment.method) + '</strong><small>Payment ' + (index + 1) + '</small></span><b>' + money(payment.amountCents) + '</b><button type="button" data-remove-payment="' + index + '" aria-label="Remove ' + esc(payment.method) + ' payment">Remove</button></div>').join("");
  document.querySelector("#paymentAllocations").innerHTML = allocationHtml || '<p class="hint">No payment amounts added yet.</p>';
  document.querySelectorAll("[data-remove-payment]").forEach((button) => button.addEventListener("click", () => {
    salePayments.splice(Number(button.dataset.removePayment), 1);
    renderPaymentState(true);
  }));
  const balanceHtml = '<article><span>Paid</span><strong>' + money(totals.paid) + '</strong></article><article><span>Remaining</span><strong>' + money(totals.remaining) + '</strong></article>' + (totals.change ? '<article class="change-due"><span>Cash to return</span><strong>' + money(totals.change) + '</strong></article>' : '');
  document.querySelector("#paymentBalance").innerHTML = balanceHtml;
  document.querySelector("#cartPaymentSummary").innerHTML = salePayments.map((payment) => '<div class="cart-payment-line"><span>' + esc(payment.method) + '</span><strong>' + money(payment.amountCents) + '</strong></div>').join("") + (totals.remaining ? '<div class="cart-payment-line balance"><span>Amount remaining</span><strong>' + money(totals.remaining) + '</strong></div>' : '') + (totals.change ? '<div class="cart-payment-line change"><span>Cash to return</span><strong>' + money(totals.change) + '</strong></div>' : '');
  document.querySelector("#completeSale").disabled = !salePayments.length || totals.paid < totals.total || totals.change > totals.cash;
  document.querySelector("#selectedPaymentMethod").textContent = totals.change ? "Payment covered. Return " + money(totals.change) + " in cash after completing the sale." : totals.remaining ? money(totals.remaining) + " remains to be paid." : "Payment covered. You can complete the sale.";
  if (syncInput) document.querySelector('#saleForm input[name="paymentAmount"]').value = totals.remaining ? dollars(totals.remaining) : "";
}
function addPayment(method) {
  const input = document.querySelector('#saleForm input[name="paymentAmount"]');
  const amountCents = Math.round(Number(input.value || 0) * 100);
  const totals = paymentTotals();
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) { setSaleMessage("Enter a valid payment amount first.", true); input.focus(); return; }
  if (!totals.remaining) { setSaleMessage("The sale is already fully paid. Remove a payment to make a change.", true); return; }
  if (method !== "Cash" && amountCents > totals.remaining) { setSaleMessage("Only cash can be more than the remaining balance.", true); input.focus(); return; }
  const existing = salePayments.find((payment) => payment.method === method);
  if (existing) existing.amountCents += amountCents;
  else salePayments.push({ method, amountCents });
  setSaleMessage("");
  renderPaymentState(true);
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
  const chips = [...row.querySelectorAll(".staff-chip")];
  if (!chips.length) return "";
  if (Math.abs(totals.percent - 100) > 0.01) return "Staff percentages must total 100%.";
  if (Math.abs(totals.amount - serviceAmount) > 0.011) return "Staff amounts must total " + money(Math.round(serviceAmount * 100)) + ".";
  if (chips.some((chip) => Math.abs(Number(chip.querySelector('input[name="staffAmount"]').value || 0) - serviceAmount * Number(chip.querySelector('input[name="staffPercent"]').value || 0) / 100) > 0.011)) return "Each staff amount must match its percentage.";
  return "";
}
function updateAllocationSummary(row) {
  const totals = allocationTotals(row);
  const summary = row.querySelector(".allocation-summary");
  if (!summary) return;
  const error = allocationError(row);
  summary.textContent = error || ("Allocated: " + totals.percent.toFixed(2).replace(/\.00$/, "") + "% · $" + totals.amount.toFixed(2));
  summary.classList.toggle("allocation-error", Boolean(error));
}
function setAllocation(chip, percent, amountCents) {
  chip.querySelector('input[name="staffPercent"]').value = Number(percent.toFixed(2));
  chip.querySelector('input[name="staffAmount"]').value = (amountCents / 100).toFixed(2);
}
function rebalanceStaffAllocations(row, sourceChip = null, sourceKind = "equal") {
  const chips = [...row.querySelectorAll(".staff-chip")];
  const totalCents = Math.max(0, Math.round(Number(row.querySelector('input[name="instancePrice"]').value || 0) * 100));
  if (!chips.length || !totalCents) { updateAllocationSummary(row); return; }
  if (sourceKind === "preserve") {
    let assigned = 0;
    chips.forEach((chip, index) => {
      const percent = Math.max(0, Number(chip.querySelector('input[name="staffPercent"]').value || 0));
      const amount = index === chips.length - 1 ? Math.max(0, totalCents - assigned) : Math.round(totalCents * percent / 100);
      assigned += amount;
      setAllocation(chip, percent, amount);
    });
    updateAllocationSummary(row);
    return;
  }
  if (!sourceChip || chips.length === 1) {
    let assignedPercent = 0;
    let assigned = 0;
    chips.forEach((chip, index) => {
      const percent = index === chips.length - 1 ? 100 - assignedPercent : Number((100 / chips.length).toFixed(2));
      const amount = index === chips.length - 1 ? totalCents - assigned : Math.round(totalCents / chips.length);
      assignedPercent += percent;
      assigned += amount;
      setAllocation(chip, percent, amount);
    });
  } else {
    const others = chips.filter((chip) => chip !== sourceChip);
    let sourcePercent;
    let sourceAmount;
    if (sourceKind === "amount") {
      sourceAmount = Math.min(totalCents, Math.max(0, Math.round(Number(sourceChip.querySelector('input[name="staffAmount"]').value || 0) * 100)));
      sourcePercent = totalCents ? sourceAmount * 100 / totalCents : 0;
    } else {
      sourcePercent = Math.min(100, Math.max(0, Number(sourceChip.querySelector('input[name="staffPercent"]').value || 0)));
      sourceAmount = Math.round(totalCents * sourcePercent / 100);
    }
    setAllocation(sourceChip, sourcePercent, sourceAmount);
    const remainingPercent = Math.max(0, 100 - sourcePercent);
    const remainingCents = Math.max(0, totalCents - sourceAmount);
    let assignedPercent = 0;
    let assignedCents = 0;
    others.forEach((chip, index) => {
      const percent = index === others.length - 1 ? remainingPercent - assignedPercent : Number((remainingPercent / others.length).toFixed(2));
      const amount = index === others.length - 1 ? remainingCents - assignedCents : Math.round(remainingCents / others.length);
      assignedPercent += percent;
      assignedCents += amount;
      setAllocation(chip, percent, amount);
    });
  }
  updateAllocationSummary(row);
}
function staffCheckboxes() { return state.staff.map((s) => '<label class="mini-check"><input type="checkbox" name="saleStaffIds" value="' + s.id + '">' + esc(s.name) + '</label>').join(""); }
function staffSelectOptions(value) { return '<option value="">Unassigned</option>' + state.staff.map((s) => '<option value="' + s.id + '"' + selected(value, s.id) + '>' + esc(s.name) + '</option>').join(""); }
function addStaffToSaleItem(row) {
  const input = row.querySelector('input[name="saleStaffSearch"]');
  const staff = findStaff(input.value);
  if (!staff) { message.textContent = "Select a staff member from the list."; return; }
  if (row.querySelector('input[name="saleStaffIds"][value="' + cssEsc(staff.id) + '"]')) { input.value = ""; return; }
  const chip = document.createElement("div");
  chip.className = "staff-chip";
  chip.innerHTML = '<input type="checkbox" name="saleStaffIds" value="' + esc(staff.id) + '" checked><span>' + esc(staff.name) + '</span><label>%<input name="staffPercent" type="number" min="0" max="100" step="0.01" placeholder="%"></label><label>$<input name="staffAmount" type="number" min="0" step="0.01" placeholder="$"></label><button type="button" aria-label="Remove staff">x</button>';
  chip.querySelector('input[name="staffPercent"]').addEventListener("change", () => rebalanceStaffAllocations(row, chip, "percent"));
  chip.querySelector('input[name="staffAmount"]').addEventListener("change", () => rebalanceStaffAllocations(row, chip, "amount"));
  chip.querySelector("button").addEventListener("click", () => { chip.remove(); rebalanceStaffAllocations(row); });
  row.querySelector(".selected-staff").append(chip);
  input.value = "";
  rebalanceStaffAllocations(row);
}
function findCustomerId(value) { return state.customers.find((c) => customerLabel(c) === value)?.id || ""; }
function findSaleItem(value) { return saleCatalog().find((item) => item.label === value); }
function findStaff(value) { return state.staff.find((s) => staffLabel(s) === value); }
function customerLabel(c) { return (c.first_name + " " + c.last_name + " | " + c.phone + " | " + c.email).trim(); }
function saleCatalog() {
  return [
    ...state.services.map((s) => ({ type:"service", typeLabel:"Service", id:s.id, name:s.name, priceCents:Number(s.price_cents || 0), label:"Service | " + s.name + " | " + s.category + " | " + money(s.price_cents) })),
    ...(state.products || []).map((p) => { const priceCents = Number(p.special_price_cents || 0) > 0 ? Number(p.special_price_cents) : Number(p.price_cents || 0); return { type:"product", typeLabel:"Product", id:p.id, name:p.name, priceCents, label:"Product | " + p.name + " | " + (p.brand || p.category) + " | " + money(priceCents) }; })
  ];
}
function saleQuickFindScore(item, query) {
  const name = item.name.toLowerCase();
  const label = item.label.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (label.startsWith(query)) return 3;
  if (label.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}
function updateSaleQuickFind(value) {
  const list = document.querySelector("#itemList");
  const query = String(value || "").trim().toLowerCase();
  if (query.length < 2) { list.innerHTML = ""; return; }
  const matches = saleCatalog()
    .map((item) => ({ item, score:saleQuickFindScore(item, query) }))
    .filter((match) => Number.isFinite(match.score))
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 6);
  list.innerHTML = matches.map(({ item }) => '<option value="' + esc(item.label) + '"></option>').join("");
}
function staffLabel(s) { return s.name + " | " + (s.phone || "No phone") + " | " + (s.email || "No email") + " | " + (s.branch_name || branchName(s.branch_id)); }
function cssEsc(value) { return String(value).replace(/"/g, '\\"'); }
function selected(value, expected) { return value === expected ? " selected" : ""; }
function syncLastReceiptButton() {
  const button = document.querySelector("#printLastReceiptButton");
  if (button) button.disabled = !lastReceipt;
}
function receiptHasCash(receipt) {
  if (!receipt) return false;
  if (Number(receipt.cashCents || 0) > 0) return true;
  return Array.isArray(receipt.payments) && receipt.payments.some((payment) => payment.method === "Cash" && Number(payment.amountCents || 0) > 0);
}
function showCheckoutReceiptPrompt(receipt) {
  const dialog = document.querySelector("#checkoutCompleteDialog");
  const drawerButton = document.querySelector("#openCashDrawer");
  document.querySelector("#checkoutCompleteSummary").textContent = "Payment of " + money(receipt.totalCents) + " was completed successfully.";
  drawerButton.hidden = !receiptHasCash(receipt);
  drawerButton.disabled = false;
  document.querySelector("#cashDrawerStatus").textContent = drawerButton.hidden ? "" : "Open cash drawer prints a tiny dash so the receipt printer can trigger the drawer.";
  if (!dialog.open) dialog.showModal();
  document.querySelector("#checkoutPrintReceipt").focus();
}
function clearCheckoutReceiptPrompt() {
  const drawerButton = document.querySelector("#openCashDrawer");
  drawerButton.hidden = true;
  drawerButton.disabled = false;
  document.querySelector("#cashDrawerStatus").textContent = "";
}
async function openCashDrawer(source) {
  const fromClosing = source === "daily_closing";
  const button = document.querySelector(fromClosing ? "#closingOpenCashDrawer" : "#openCashDrawer");
  const status = document.querySelector(fromClosing ? "#closingCashDrawerStatus" : "#cashDrawerStatus");
  const branchId = fromClosing ? selectedPosBranchId : (lastReceipt?.branchId || selectedPosBranchId);
  if (!fromClosing && !receiptHasCash(lastReceipt)) { status.textContent = "The cash drawer is available only for a cash payment."; return; }
  if (!branchId) { status.textContent = "Open a branch workspace first."; return; }
  const drawerJob = window.open("", "kunchasDrawer", "width=260,height=220");
  if (!drawerJob) { status.textContent = "Allow pop-ups so the drawer print job can open."; return; }
  drawerJob.document.write('<!doctype html><html><head><title>Cash drawer</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding:24px">Preparing drawer slip…</body></html>');
  drawerJob.document.close();
  button.disabled = true;
  try {
    let actor = {};
    if (fromClosing) {
      actor = await askActor(branchId, false, "Open cash drawer for daily closing", false);
      if (!actor) { drawerJob.close(); return; }
    }
    status.textContent = "Recording cash drawer opening…";
    const result = await api("/api/cash-drawer-open", { method:"POST", body:JSON.stringify({ ...actor, branchId, source, saleId:fromClosing ? "" : lastReceipt.saleId }) });
    state.cashDrawerOpens.unshift(result.record);
    renderCashDrawerHistory();
    printCashDrawerSlip(drawerJob);
    status.textContent = "Recorded at " + new Date(result.record.opened_at).toLocaleString("en-AU") + ". Print the small dash to open the drawer.";
  } catch (error) {
    drawerJob.close();
    status.textContent = error.message;
  } finally { button.disabled = false; }
}
function printCashDrawerSlip(drawerJob) {
  drawerJob.document.open();
  drawerJob.document.write('<!doctype html><html><head><title>Open cash drawer</title><style>@page{size:58mm 5mm;margin:0!important}html,body{width:58mm;height:5mm;margin:0!important;padding:0!important;overflow:hidden}body{font:1px/1px Arial,sans-serif;color:#000}@media print{html,body{width:58mm!important;height:5mm!important}}</style></head><body>-</body></html>');
  drawerJob.document.close();
  drawerJob.onafterprint = () => drawerJob.close();
  setTimeout(() => { drawerJob.focus(); drawerJob.print(); }, 150);
}
function printLastReceipt() {
  if (!lastReceipt) { message.textContent = "Complete a sale first."; return; }
  const receipt = window.open("", "kunchasReceipt", "width=380,height=640");
  if (!receipt) { message.textContent = "Allow pop-ups to print the receipt."; return; }
  const detailedPayments = Array.isArray(lastReceipt.payments) ? lastReceipt.payments.filter((payment) => Number(payment.amountCents || 0) > 0) : [];
  const paymentRows = (detailedPayments.length ? detailedPayments.map((payment) => '<div class="row"><span>' + esc(payment.method) + ' paid</span><strong>' + money(payment.amountCents) + '</strong></div>').join("") : (lastReceipt.cashCents ? '<div class="row"><span>Cash paid</span><strong>' + money(lastReceipt.cashCents) + '</strong></div>' : '') + (lastReceipt.cardCents ? '<div class="row"><span>Card paid</span><strong>' + money(lastReceipt.cardCents) + '</strong></div>' : '') + (!lastReceipt.cashCents && !lastReceipt.cardCents ? '<div class="row"><span>Payment</span><strong>' + esc(lastReceipt.paymentMethod || "Paid") + '</strong></div>' : '')) + (lastReceipt.changeCents ? '<div class="row total"><span>Change to return</span><span>' + money(lastReceipt.changeCents) + '</span></div>' : '');
  receipt.document.write('<!doctype html><html><head><title>Kunchas receipt</title><style>body{font-family:Arial,sans-serif;margin:18px;color:#111}.center{text-align:center}h1{font-size:20px;margin:0}.line{border-top:1px dashed #999;margin:12px 0}.row{display:flex;justify-content:space-between;gap:12px;margin:6px 0}.total{font-weight:800;font-size:18px}</style></head><body><div class="center"><img alt="Kuncha’s Hair &amp; Beauty Art" style="width:200px;max-width:100%;height:auto" src="' + esc(document.querySelector('.brand img').src) + '"><div>' + esc(lastReceipt.branch?.name || "") + '</div><div>' + esc(lastReceipt.branch?.phone || "") + '</div></div><div class="line"></div><div>Receipt: ' + esc(lastReceipt.saleId) + '</div><div>' + esc(new Date(lastReceipt.createdAt).toLocaleString("en-AU")) + '</div><div class="line"></div>' + lastReceipt.items.map((item) => '<div class="row"><span>' + esc(item.name) + '</span><strong>' + money(item.priceCents) + '</strong></div>').join("") + '<div class="line"></div><div class="row total"><span>Total</span><span>' + money(lastReceipt.totalCents) + '</span></div>' + paymentRows + '<p class="center">Thank you</p></body></html>');
  receipt.document.close();
  receipt.focus();
  receipt.print();
}
function branchName(id) { return [...state.branches, ...(state.archivedBranches || [])].find((branch) => branch.id === id)?.name || "No branch"; }
function money(cents) { return new Intl.NumberFormat("en-AU", { style:"currency", currency:"AUD" }).format(Number(cents || 0) / 100); }
function dollars(cents) { return (Number(cents || 0) / 100).toFixed(2); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c])); }`;
}

function styles() {
  return `
:root { --ink:#1c1724; --muted:#716b79; --line:#e7e1ea; --soft:#f8f6f9; --brand:#5b1b6f; --brand-dark:#3b1048; --brand-soft:#f3eaf6; --gold:#d59b48; --surface:#fff; --success:#087f5b; }
* { box-sizing:border-box; }
body { margin:0; display:grid; grid-template-columns:228px minmax(0,1fr); min-height:100vh; color:var(--ink); background:var(--soft); font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; line-height:1.5; }
.sidebar { position:sticky; top:0; height:100vh; display:flex; flex-direction:column; overflow-y:auto; padding:24px 14px; background:linear-gradient(180deg,#471456,#35103f); color:#fff; }
.sidebar-footer { display:grid; gap:8px; margin-top:auto; padding-top:24px; }
.sidebar-footer .nav { width:100%; border-top:1px solid #ffffff30; border-radius:0; }
body.pos-locked { grid-template-columns:1fr; }
.pos-locked .sidebar,.pos-locked .topbar,.pos-locked .account-tools,.pos-locked .tab { display:none!important; }
.pos-locked .app { width:min(100%,540px); min-height:100dvh; margin:auto; padding:24px; display:flex; flex-direction:column; justify-content:center; }
.pos-locked #posLogin { order:1; margin:0; }
.pos-locked #posLogin .grid { grid-template-columns:1fr; margin-top:24px; }
.pos-locked #message { order:2; text-align:center; }
.brand { display:flex; align-items:center; justify-content:center; margin-bottom:26px; padding:8px; background:#fff; border-radius:12px; flex-shrink:0; }
.brand img { display:block; width:100%; max-width:210px; height:auto; }
.login-brand-logo { display:block; width:min(100%,280px); height:auto; margin:0 auto 22px; }
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
[hidden] { display:none!important; }
.account-tools { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:10px; padding:12px 40px; background:#fff; border-bottom:1px solid var(--line); font-size:13px; }
#access .panel { margin-top:20px; }
#accessPolicyRows select { min-width:170px; max-width:260px; }
.hint { margin:8px 0 0; color:var(--muted); font-size:13px; }
.sale-message { min-height:22px; margin:10px 0 0; color:#087f5b; font-size:13px; font-weight:800; }
.sale-message:empty { display:none; }
.sale-message.error { color:#b42318; }
.checkout-complete-actions { display:flex; gap:12px; }
.checkout-complete-actions button { flex:1; }
button:disabled { cursor:wait; opacity:.65; }
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
.account-dropdown { position:relative; }
.account-dropdown summary { cursor:pointer; list-style:none; min-height:44px; border-radius:12px; padding:4px 8px; }
.account-dropdown summary::-webkit-details-marker { display:none; }
.account-dropdown summary:focus-visible { outline:3px solid var(--brand); outline-offset:3px; }
.account-dropdown-panel { position:absolute; right:0; top:calc(100% + 10px); z-index:50; width:230px; max-width:calc(100vw - 40px); padding:8px; background:#fff; border:1px solid var(--line); border-radius:14px; box-shadow:0 12px 36px #251c2c20; }
.account-dropdown-panel p { margin:6px 10px 10px; color:var(--muted); font-size:12px; }
.account-dropdown-panel button { display:block; width:100%; min-height:44px; padding:10px 12px; border:0; border-radius:8px; background:transparent; text-align:left; font:inherit; cursor:pointer; }
.account-dropdown-panel button:hover,.account-dropdown-panel button:focus-visible { background:#fff0f6; color:var(--brand); }
.staff-directory { display:grid; gap:20px; }
.staff-editor { scroll-margin-top:24px; }
.staff-list-filters { display:flex; align-items:end; gap:14px; flex-wrap:wrap; }
.staff-list-filters label { margin:0; }
.staff-list-filters input { min-width:240px; }
@media(max-width:640px) { .staff-list-heading { align-items:stretch; flex-direction:column; } .staff-list-filters { display:grid; grid-template-columns:1fr; } .staff-list-filters input { min-width:0; } .account-dropdown summary strong { max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } }
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
.product-top-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr); gap:20px; align-items:stretch; }
.product-editor { margin:0; }
.product-editor .section-heading { align-items:flex-start; margin-bottom:14px; }
.product-editor .section-heading h2 { margin-top:2px; }
.product-excel-panel { position:relative; overflow:hidden; background:linear-gradient(145deg,#fff 10%,#faf3fc 100%); }
.product-excel-panel::after { position:absolute; right:-58px; bottom:-70px; width:170px; height:170px; content:""; background:rgba(91,27,111,.07); border-radius:50%; }
.excel-icon { position:relative; z-index:1; display:grid; place-items:center; width:48px; height:48px; margin-bottom:18px; color:#fff; background:var(--brand); border-radius:13px; }
.excel-actions { position:relative; z-index:1; display:flex; flex-wrap:wrap; gap:10px; margin-top:22px; }
.button-link { display:inline-flex; align-items:center; justify-content:center; text-decoration:none; }
.import-result { position:relative; z-index:1; margin:14px 0 0; color:var(--brand); font-size:12px; font-weight:800; }
.product-table-panel { margin-top:20px; padding:0; overflow:hidden; }
.product-table-heading { flex-wrap:wrap; gap:16px; padding:20px 22px; background:#fff; border-bottom:1px solid var(--line); }
.product-table-heading h2 { margin-top:2px; }
.product-table-controls { display:flex; flex-wrap:wrap; align-items:end; gap:10px; max-width:100%; }
.product-table-controls label { width:min(230px,26vw); color:var(--muted); font-size:11px; text-transform:uppercase; }
.product-table-controls select,.product-table-controls input { margin:4px 0 0; min-height:40px; color:var(--ink); text-transform:none; }
.product-table-controls .product-search { width:min(330px,34vw); }
.product-table { min-width:1060px; }
.product-table th:first-child,.product-table td:first-child { padding-left:22px; }
.product-table th:last-child,.product-table td:last-child { padding-right:22px; text-align:right; }
.product-table tbody tr:hover { background:#fdfafd; }
.product-table .catalogue-group th { padding:15px 22px; text-align:left; background:var(--brand-soft); color:var(--brand); font-size:14px; text-transform:none; border-top:2px solid var(--line); }
.product-table .catalogue-subgroup th { padding:10px 22px 10px 34px; text-align:left; background:#f7f8fa; color:var(--ink); font-size:12px; text-transform:none; }
.service-hierarchy { display:grid; gap:10px; padding:18px 22px 22px; background:#faf8fb; }
.service-category-menu,.service-subcategory-menu { overflow:hidden; background:#fff; border:1px solid var(--line); border-radius:12px; }
.service-category-menu>summary,.service-subcategory-menu>summary { display:flex; min-height:54px; align-items:center; gap:10px; padding:0 18px; color:var(--brand); font-weight:800; list-style:none; cursor:pointer; }
.service-category-menu>summary::-webkit-details-marker,.service-subcategory-menu>summary::-webkit-details-marker { display:none; }
.service-category-menu>summary::before,.service-subcategory-menu>summary::before { content:"›"; font-size:24px; line-height:1; transition:transform .16s ease; }
.service-category-menu[open]>summary::before,.service-subcategory-menu[open]>summary::before { transform:rotate(90deg); }
.service-category-menu>summary:focus-visible,.service-subcategory-menu>summary:focus-visible { outline:3px solid rgba(183,68,126,.3); outline-offset:-4px; }
.service-category-menu[open]>summary { background:var(--brand-soft); border-bottom:1px solid var(--line); }
.service-category-drag-handle { width:30px; min-height:34px; padding:0; margin-left:-7px; color:var(--muted); background:transparent; border:0; border-radius:7px; font-size:18px; line-height:1; letter-spacing:-3px; cursor:grab; touch-action:none; }
.service-category-drag-handle:hover,.service-category-drag-handle:focus-visible { color:var(--brand); background:#fff; outline:2px solid rgba(183,68,126,.25); }
.service-category-drag-handle:active { cursor:grabbing; }
.service-category-pin { display:inline-flex; width:30px; min-height:34px; align-items:center; justify-content:center; padding:0; color:var(--muted); background:transparent; border:0; border-radius:7px; font-size:15px; filter:grayscale(1); opacity:.45; }
.service-category-pin:hover,.service-category-pin:focus-visible { color:var(--brand); background:#fff; outline:2px solid rgba(183,68,126,.25); opacity:.8; }
.service-category-pin.pinned { color:var(--brand); background:#fff; filter:none; opacity:1; }
.catalogue-name-edit { width:30px; min-height:30px; padding:0; color:var(--muted); background:transparent; border:0; border-radius:7px; font-size:15px; }
.catalogue-name-edit:hover,.catalogue-name-edit:focus-visible { color:var(--brand); background:#fff; outline:2px solid rgba(183,68,126,.25); }
.service-category-menu>summary .catalogue-group-count,.service-subcategory-menu>summary .catalogue-group-count { margin-left:auto; }
.service-category-menu.dragging { opacity:.48; }
.service-category-menu.drag-over { border-top:3px solid var(--brand); }
.service-category-menu.drag-over.drag-after { border-top:1px solid var(--line); border-bottom:3px solid var(--brand); }
.service-subcategory-list { display:grid; gap:9px; padding:12px 14px 14px 32px; }
.service-subcategory-menu>summary { min-height:46px; color:var(--ink); background:#f7f8fa; }
.service-subcategory-menu[open]>summary { border-bottom:1px solid var(--line); }
.service-hierarchy-items { display:grid; }
.service-hierarchy-item { display:flex; min-height:58px; align-items:center; justify-content:space-between; gap:16px; padding:10px 16px 10px 42px; border-bottom:1px solid var(--line); }
.service-hierarchy-item:last-child { border-bottom:0; }
.service-hierarchy-item>div:first-child { display:grid; gap:4px; }
.service-hierarchy-item>div:first-child span { color:var(--muted); font-size:12px; }
.service-hierarchy-item-meta { display:flex; align-items:center; justify-content:flex-end; gap:12px; }
.service-hierarchy-empty { margin:0; padding:24px; text-align:center; }
.product-hierarchy { display:grid; gap:10px; padding:18px 22px 22px; background:#faf8fb; }
.product-category-menu,.product-subcategory-menu { overflow:hidden; background:#fff; border:1px solid var(--line); border-radius:12px; }
.product-category-menu>summary,.product-subcategory-menu>summary { display:flex; min-height:54px; align-items:center; gap:10px; padding:0 18px; color:var(--brand); font-weight:800; list-style:none; cursor:pointer; }
.product-category-menu>summary::-webkit-details-marker,.product-subcategory-menu>summary::-webkit-details-marker { display:none; }
.product-category-menu>summary::before,.product-subcategory-menu>summary::before { content:"›"; font-size:24px; line-height:1; transition:transform .16s ease; }
.product-category-menu[open]>summary::before,.product-subcategory-menu[open]>summary::before { transform:rotate(90deg); }
.product-category-menu>summary:focus-visible,.product-subcategory-menu>summary:focus-visible { outline:3px solid rgba(183,68,126,.3); outline-offset:-4px; }
.product-category-menu[open]>summary { background:var(--brand-soft); border-bottom:1px solid var(--line); }
.product-category-drag-handle { width:30px; min-height:34px; padding:0; margin-left:-7px; color:var(--muted); background:transparent; border:0; border-radius:7px; font-size:18px; line-height:1; letter-spacing:-3px; cursor:grab; touch-action:none; }
.product-category-drag-handle:hover,.product-category-drag-handle:focus-visible { color:var(--brand); background:#fff; outline:2px solid rgba(183,68,126,.25); }
.product-category-drag-handle:active { cursor:grabbing; }
.product-category-menu>summary .catalogue-group-count,.product-subcategory-menu>summary .catalogue-group-count { margin-left:auto; }
.product-category-menu.dragging,.product-hierarchy-item.dragging { opacity:.48; }
.product-category-menu.drag-over { border-top:3px solid var(--brand); }
.product-category-menu.drag-over.drag-after { border-top:1px solid var(--line); border-bottom:3px solid var(--brand); }
.product-category-menu>summary.product-drop-target,.product-subcategory-menu.product-drop-target { background:#eadcf0; outline:2px dashed var(--brand); outline-offset:-4px; }
.product-subcategory-list { display:grid; gap:9px; padding:12px 14px 14px 32px; }
.product-subcategory-menu>summary { min-height:46px; color:var(--ink); background:#f7f8fa; }
.product-subcategory-menu[open]>summary { border-bottom:1px solid var(--line); }
.product-hierarchy-items { display:grid; }
.product-hierarchy-item { display:flex; min-height:70px; align-items:center; justify-content:space-between; gap:16px; padding:11px 16px 11px 42px; border-bottom:1px solid var(--line); cursor:grab; }
.product-hierarchy-item:last-child { border-bottom:0; }
.product-hierarchy-item:active { cursor:grabbing; }
.product-item-main { display:grid; gap:4px; min-width:180px; }
.product-item-main span,.product-hierarchy-item-meta>span { color:var(--muted); font-size:12px; }
.product-hierarchy-item-meta { display:flex; align-items:center; justify-content:flex-end; gap:12px; flex-wrap:wrap; }
.product-prices { display:inline-flex; align-items:center; gap:7px; }
.product-price-retail.discounted { color:var(--muted); text-decoration:line-through; }
.product-price-special { color:#a12961; }
.product-hierarchy-empty { margin:0; padding:24px; text-align:center; }
.catalogue-group-count { display:inline-block; margin-left:12px; color:var(--muted); font-size:11px; font-weight:500; }
#newServiceCategoryLabel.hidden,#newServiceSubCategoryLabel.hidden { display:none; }
.table-subtext { display:block; max-width:230px; margin-top:3px; overflow:hidden; color:var(--muted); font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.status-pill { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; color:#087f5b; background:#e9f8f2; border-radius:999px; font-size:11px; font-weight:800; }
.status-pill::before { width:6px; height:6px; content:""; background:currentColor; border-radius:50%; }
.status-pill.inactive { color:#8a5260; background:#f8eaee; }
.stock-quantity { display:inline-flex; min-width:34px; min-height:30px; align-items:center; justify-content:center; color:var(--brand); background:var(--brand-soft); border-radius:8px; }
.receive-products-layout { margin-bottom:20px; }
#receiveProductsMessage { min-height:20px; margin-bottom:0; }
.compact-button { min-height:34px; padding:0 12px; font-size:12px; }
.time-clock-panel { display:grid; grid-template-columns:minmax(260px,1fr) minmax(220px,320px) auto; align-items:end; gap:18px; margin-bottom:20px; background:linear-gradient(135deg,#fff 30%,#faf3fc); }
.time-clock-panel h2 { margin-bottom:2px; }
.time-clock-panel label,.time-clock-panel select { margin-bottom:0; }
.time-clock-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; padding-bottom:0; }
.time-clock-actions button { min-height:40px; padding:0 13px; white-space:nowrap; }
.staff-hours-section { margin:26px -22px -22px; border-top:1px solid var(--line); }
.staff-hours-section>.section-heading { padding:18px 22px; background:#faf8fb; border-bottom:1px solid var(--line); }
.staff-hours-section h3 { margin:0; font-size:20px; }
.staff-hours-section>.section-heading>strong { color:var(--brand); }
.staff-hours-table { min-width:900px; }
.staff-hours-table th:first-child,.staff-hours-table td:first-child { padding-left:22px; }
.staff-hours-table th:last-child,.staff-hours-table td:last-child { padding-right:22px; }
.no-hours-row { color:var(--muted); background:#fdfcfd; }
.xero-fields { margin:4px 0 16px; padding:12px 14px; background:#faf8fb; border:1px solid var(--line); border-radius:9px; }
.xero-fields summary { color:var(--brand); font-weight:800; cursor:pointer; }
.xero-fields .grid { margin-top:12px; }
.report-filter-panel { display:flex; align-items:end; justify-content:space-between; gap:24px; background:linear-gradient(135deg,#fff 40%,#f7edf9); }
.report-filter-panel h2 { margin-bottom:2px; }
.report-filters { display:grid; grid-template-columns:145px 145px minmax(180px,240px) auto; align-items:end; gap:10px; }
.report-filters label { color:var(--muted); font-size:11px; text-transform:uppercase; }
.report-filters input,.report-filters select { min-height:40px; margin:4px 0 0; color:var(--ink); text-transform:none; }
.report-summary { grid-template-columns:repeat(7,minmax(130px,1fr)); margin:18px 0; overflow-x:auto; }
.report-summary article { min-width:138px; }
.report-summary strong { font-size:24px; }
.report-section { margin-top:18px; padding:0; overflow:hidden; }
.report-section>.section-heading { padding:18px 20px; background:#faf8fb; border-bottom:1px solid var(--line); }
.report-section>.section-heading h2 { font-size:20px; }
.report-section table { min-width:820px; }
.report-section th:first-child,.report-section td:first-child { padding-left:20px; }
.report-section th:last-child,.report-section td:last-child { padding-right:20px; }
.report-two-column { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
.report-two-column .report-section table { min-width:480px; }
.report-export { white-space:nowrap; }
.report-export-actions { display:flex; flex-wrap:wrap; gap:8px; }
.source-pill { display:inline-flex; padding:5px 9px; color:var(--brand); background:var(--brand-soft); border-radius:999px; font-size:11px; font-weight:800; }
.payroll-report table { min-width:1120px; }
.service-editor { max-width:760px; margin-bottom:20px; }
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
.edit-service { position:static; width:40px; min-height:40px; padding:0; color:#9b3444; background:#fff; border:1px solid #eadbd6; border-radius:50%; font-size:19px; line-height:1; cursor:pointer; }
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
.booking-customer-card { display:grid; gap:2px; margin:0 0 16px; padding:14px 16px; color:#0b3558; background:#eef7ff; border:1px solid #cfe4f5; border-radius:10px; }
.booking-customer-card.hidden { display:none; }
.booking-customer-card span { color:#54738d; font-size:11px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; }
.booking-customer-card strong { font-size:17px; }.booking-customer-card em { color:#54738d; font-size:13px; font-style:normal; }
.checkout-total { display:flex; align-items:center; justify-content:space-between; gap:18px; margin:20px 0 12px; padding:18px; color:#fff; background:linear-gradient(135deg,var(--brand),var(--brand-dark)); border-radius:12px; }
.checkout-total span { font-weight:800; }.checkout-total strong { font-size:30px; }
.pay-button { min-height:54px; font-size:17px; }
.payment-panel { margin-top:16px; padding:20px; background:#fff; border:2px solid #d7c6df; border-radius:14px; }
.payment-heading { display:flex; align-items:end; justify-content:space-between; gap:18px; margin-bottom:14px; }
.payment-heading h3 { margin:0; font-size:22px; }.payment-heading label { width:min(220px,45%); }.payment-heading input { margin-bottom:0; }
.payment-methods { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.payment-methods button { color:#073b78; background:#fff; border:2px solid #0d4a91; border-radius:999px; }
.payment-methods button.selected { color:#fff; background:#0d4a91; box-shadow:0 0 0 3px #cfe2fa; }
.payment-methods button:last-child { grid-column:1/-1; }
.payment-allocations { display:grid; gap:8px; margin-top:14px; }
.payment-allocation { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:12px; padding:10px 12px; background:#f8fbfc; border:1px solid var(--line); border-radius:9px; }
.payment-allocation span,.payment-allocation small { display:block; }.payment-allocation small { color:var(--muted); }
.payment-allocation button { min-height:34px; padding:6px 10px; color:#9b3444; background:#fff3ef; }
.payment-balance { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:14px 0; }
.payment-balance article { padding:12px; background:#f8fbfc; border:1px solid var(--line); border-radius:9px; }
.payment-balance span { display:block; color:var(--muted); font-size:12px; font-weight:800; }.payment-balance strong { display:block; margin-top:3px; font-size:20px; }
.payment-balance .change-due { color:#7a3e00; background:#fff8e6; border-color:#edcf83; }
.cart-payment-summary { display:grid; gap:7px; margin-top:14px; }
.cart-payment-line { display:flex; justify-content:space-between; gap:12px; padding:8px 10px; color:#365166; background:#f8fbfc; border-radius:7px; }
.cart-payment-line.balance { color:#9b3444; background:#fff3ef; }.cart-payment-line.change { color:#7a3e00; background:#fff8e6; }
.closing-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:10px 0 14px; }
.closing-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:18px; }
.closing-layout .panel { margin:0; min-width:0; }
.drawer-closing-control { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; margin:0 0 18px; padding:14px; background:#fff8e6; border:1px solid #edcf83; border-radius:10px; }
.drawer-closing-control p { margin:3px 0 0; }.drawer-closing-control>p { grid-column:1/-1; }
.closing-overview { margin:12px 0 20px; width:100%; }
.closing-overview th { background:#e5e8ec; white-space:nowrap; }.closing-overview td { background:#f4f6f8; }
.cash-counter { display:block; }.denomination-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:12px; }
.closing-fields { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
@media(max-width:700px){.denomination-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.closing-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.drawer-closing-control{grid-template-columns:1fr}.drawer-closing-control button{width:100%}}
.closing-summary article { padding:12px; background:#f8fbfc; border:1px solid var(--line); border-radius:8px; }
.closing-summary span { display:block; color:var(--muted); font-size:12px; font-weight:800; }
.closing-summary strong { display:block; margin-top:4px; font-size:20px; }
.closing-summary article.closing-balanced { color:#166534; background:#dcfce7; border-color:#86efac; }
.closing-summary article.closing-unbalanced { color:#991b1b; background:#fee2e2; border-color:#fca5a5; }
.closing-summary .closing-balanced span,.closing-summary .closing-unbalanced span { color:inherit; }
.field-label { display:block; margin-bottom:8px; font-weight:800; }
.staff-checks { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.mini-check { display:flex; align-items:center; gap:8px; min-height:44px; padding:10px; margin:0; background:#fff; border:1px solid var(--line); border-radius:8px; font-weight:700; }
.mini-check input { width:auto; min-height:auto; margin:0; }
.staff-add-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:start; }
.staff-add-row input { margin-top:0; }
.booking-service-picker { margin-bottom:14px; }
.booking-service-menu { margin-top:8px; padding:12px; background:#fff; border:1px solid var(--line); border-radius:10px; box-shadow:0 12px 30px rgba(28,20,34,.12); }
.booking-service-categories { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.booking-picker-title { grid-column:1/-1; margin:0 0 4px; color:var(--muted); font-size:12px; font-weight:800; }
.booking-category-option,.booking-service-option { width:100%; color:var(--ink); background:#faf8fb; border:1px solid var(--line); text-align:left; }
.booking-picker-heading,.booking-service-option { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.booking-category-services { margin-top:10px; }
.booking-service-option { margin-top:8px; }
.booking-service-option span,.booking-service-option strong,.booking-service-option em { display:block; }
.booking-service-option em { color:var(--muted); font-size:12px; font-style:normal; }
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
.booking-date-heading { display:flex; align-items:end; justify-content:space-between; gap:18px; }
.diary-panel { min-width:0; grid-column:1/-1; order:-1; }
#bookings .split { grid-template-columns:1fr; }
#bookingForm { max-width:760px; }
.diary-date-controls { display:flex; align-items:end; gap:8px; }
.diary-date-controls button { min-height:44px; padding:0 12px; margin-bottom:14px; }
.booking-legend { display:flex; justify-content:flex-end; gap:16px; margin-top:12px; color:var(--muted); font-size:12px; font-weight:800; }
.booking-legend span { display:flex; align-items:center; gap:6px; }
.booking-legend i { width:10px; height:10px; border-radius:3px; }
.booking-legend i.online { background:#287f68; }.booking-legend i.manual { background:#b84e5c; }
.booking-diary { margin-top:10px; overflow:auto; border:1px solid #dbe3f1; border-radius:10px; background:#fff; }
.booking-calendar { display:grid; grid-template-columns:76px minmax(calc(var(--staff-count) * 210px),1fr); grid-template-rows:54px 648px; min-width:940px; }
.booking-staff-spacer { grid-column:1; grid-row:1; border-right:1px solid #dbe3f1; border-bottom:1px solid #dbe3f1; }
.booking-staff-headers { display:grid; grid-column:2; grid-row:1; grid-template-columns:repeat(var(--staff-count),minmax(210px,1fr)); }
.booking-staff-headers div { display:grid; place-items:center; border-right:1px solid #dbe3f1; border-bottom:1px solid #dbe3f1; font-weight:900; }
.booking-time-rail { position:relative; grid-column:1; grid-row:2; border-right:1px solid #dbe3f1; background:#fbfcff; }
.booking-time-rail time { position:absolute; right:8px; color:#718096; font-size:9px; transform:translateY(-50%); }.booking-time-rail time.hour { color:#26385f; font-size:11px; font-weight:900; }
.booking-lanes { display:grid; grid-column:2; grid-row:2; grid-template-columns:repeat(var(--staff-count),minmax(210px,1fr)); }
.booking-now { grid-area:2/1/3/-1; align-self:start; position:relative; height:0; border-top:2px solid #dc2626; z-index:5; pointer-events:none; }
.booking-now span { position:absolute; left:0; top:-11px; background:#dc2626; color:white; padding:2px 4px; border-radius:4px; font-size:10px; font-weight:800; }
.booking-status-history { padding:16px 0; }
.closing-sale-edit { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; min-height:32px; padding:0; border:1px solid #e8dce4; border-radius:7px; background:#fff; color:#846576; vertical-align:middle; }
.closing-sale-edit:hover { color:#9c3468; background:#fff0f6; border-color:#d9a6bf; }
.closing-sale-edit:focus-visible { outline:2px solid #b7447e; outline-offset:3px; }
@media(pointer:coarse){.closing-sale-edit{width:44px;height:44px;min-height:44px}}
.booking-history-row { display:flex; justify-content:space-between; gap:16px; width:100%; margin:8px 0; padding:12px; text-align:left; }
.booking-no-show { color:#b42318; white-space:nowrap; }.booking-cancelled { color:#67566e; white-space:nowrap; }
.booking-overflow { color:#b42318; padding:12px; border:1px solid #f6b5ad; }
.booking-staff-lane .booking-card { min-height:0; padding:2px 8px; }
.booking-staff-lane { position:relative; height:648px; border-right:1px solid #dbe3f1; background:repeating-linear-gradient(to bottom,#fff 0,#fff 17px,#edf1f7 18px); }
.booking-card { position:absolute; left:8px; right:8px; z-index:1; min-height:52px; padding:9px 12px; overflow:hidden; color:#081632; border:1px solid; border-radius:8px; text-align:left; box-shadow:none; }
.booking-card.lane-0{background:#fde4ef;border-color:#ff9dc7}.booking-card.lane-1{background:#dcf7fb;border-color:#72d4df}.booking-card.lane-2{background:#e7e2ff;border-color:#b7a8fa}.booking-card.lane-3{background:#e0f8f2;border-color:#74d9c4}
.booking-card.manual,.booking-card.online { border-left-width:4px; }.booking-card.online{border-left-color:#287f68}
.booking-card strong,.booking-time,.booking-note { display:block; }.booking-time{margin-top:3px;font-size:12px}.booking-meta{display:flex;align-items:center;gap:6px;margin-top:5px;color:#4d5c79;font-size:11px}.booking-note{margin-top:4px;color:#6d3440;font-size:11px;font-style:italic}
.source-badge { display:inline-flex; width:max-content; padding:3px 7px; border-radius:999px; font-size:10px; font-weight:900; text-transform:uppercase; }.source-badge.online{color:#17634f;background:#d8f1e9}.source-badge.manual{color:#913847;background:#f7dfe1}
.booking-empty{position:sticky;left:100px;margin:28px}.booking-detail{margin-top:18px;padding:18px;background:#fff8f5;border:1px solid #eadbd6;border-radius:10px}.booking-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0}.booking-detail-grid article{padding:12px;background:#fff;border:1px solid var(--line);border-radius:8px}.booking-edit-actions{flex-wrap:wrap}
@media (max-width:1100px){ .dashboard-lower-grid{grid-template-columns:1fr}.roster-table-head{display:none}.roster-person,.branch-assign-row{grid-template-columns:minmax(180px,1fr) 120px 120px}.roster-row-actions,.branch-assign-row button{grid-column:1/-1}.roster-row-actions{justify-content:flex-end}.branch-assign-row button{justify-self:end;width:auto} }
@media (max-width:1000px){ body{grid-template-columns:1fr}.sidebar{position:static;height:auto}.topbar,.split{grid-template-columns:1fr;display:grid}.product-top-grid,.report-two-column{grid-template-columns:1fr}.time-clock-panel{grid-template-columns:1fr 1fr}.time-clock-actions{grid-column:1/-1}.report-filter-panel{align-items:stretch;flex-direction:column}.report-filters{width:100%;grid-template-columns:repeat(3,1fr) auto}.metrics,.cards,.branch-grid{grid-template-columns:repeat(2,minmax(0,1fr))} }
@media (max-width:700px){ .topbar,.dashboard-toolbar,.admin-controls,.roster-toolbar,.product-table-heading,.report-section>.section-heading,.payment-heading{align-items:stretch;flex-direction:column}.product-table-controls{align-items:stretch;flex-direction:column}.product-table-controls label,.product-table-controls .product-search,.payment-heading label{width:100%}.time-clock-panel,.report-filters,.payment-methods,.payment-balance{grid-template-columns:1fr}.payment-methods button:last-child{grid-column:auto}.payment-allocation{grid-template-columns:minmax(0,1fr) auto}.payment-allocation button{grid-column:1/-1}.time-clock-actions{grid-column:auto}.report-filters button{width:100%}.roster-toolbar-controls{grid-template-columns:1fr}.period-tabs{display:grid;grid-template-columns:repeat(2,1fr)}.branch-switcher{min-width:0}.metrics,.cards,.branch-grid,.grid,fieldset,.staff-checks,.closing-summary,.roster-person,.branch-assign-row,.timetable-list{grid-template-columns:1fr}.branch-roster-heading{align-items:flex-start;flex-direction:column}.roster-day-stats{justify-content:flex-start}.roster-person,.branch-assign-row{padding-left:18px;padding-right:18px}.roster-row-actions{justify-content:flex-start}.branch-assign-row button{justify-self:stretch;width:100%}.month-day{min-height:76px}.month-day span{display:none} }
@media (max-width:700px){.service-hierarchy,.product-hierarchy{padding:14px}.service-subcategory-list,.product-subcategory-list{padding:10px}.service-hierarchy-item,.product-hierarchy-item{align-items:flex-start;flex-direction:column;padding:12px 16px}.service-hierarchy-item-meta,.product-hierarchy-item-meta{width:100%;justify-content:flex-start;flex-wrap:wrap}}

/* Branch management */
.branch-hours-table { min-width:480px; width:100%; table-layout:fixed; }.branch-hours-table th:last-child { width:68px; }.branch-hours-table td,.branch-hours-table th { padding:10px 8px; }.branch-hours-table input { width:100%; }
.branch-dialog { width:min(800px,calc(100vw - 32px)); max-height:90dvh; padding:0; border:1px solid #e1e6ed; border-radius:20px; color:var(--ink); background:#fff; box-shadow:0 24px 80px #18213438; }
.branch-dialog::backdrop { background:#17213788; backdrop-filter:blur(3px); }
.branch-dialog-header { display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding:24px 28px; border-bottom:1px solid var(--line); background:#fff; }
.branch-dialog h2,.branch-dialog h3 { margin:0; }.branch-dialog .hint { margin:6px 0 0; line-height:1.5; }
.branch-dialog-body { padding:24px 28px; background:#f7f9fb; }
.branch-form-section { padding:20px; margin-bottom:18px; background:#fff; border:1px solid var(--line); border-radius:12px; }.branch-form-section:last-child { margin-bottom:0; }
.branch-dialog-footer { position:sticky; bottom:0; padding:16px 28px; border-top:1px solid var(--line); background:#fff; }.branch-dialog-footer p:empty { display:none; }.branch-dialog-footer .section-heading { margin:0; }
.branch-dialog [role=alert] { color:#a32937; font-size:13px; }
.branch-icon-button { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; min-height:32px; padding:0!important; border-radius:8px; vertical-align:middle; }
.branch-icon-button.danger { background:#fff; color:#ad3c48; border:1px solid #efdae0; }.branch-icon-button.danger:hover { background:#fff0f2; }
.branch-dialog .small,.branch-archive .small { padding:7px 10px; font-size:12px; }
.branch-archive { margin-top:18px; }.branch-archive summary { cursor:pointer; font-weight:700; }.branch-archive summary .pill { margin-left:8px; }
#branchHoursEditor input[type=time] { min-width:108px; padding:8px; margin:0; }#branchHoursEditor input[type=checkbox] { width:18px; height:18px; accent-color:#405e88; }#branchHoursEditor input:disabled { opacity:.45; }
.branch-closure-row { grid-template-columns:1fr 1.4fr auto; align-items:end; gap:12px; }.branch-closure-row button { margin-bottom:14px; padding:9px 12px; font-size:12px; }
#branchClosedDatesEditor:empty::after { content:"No closed dates added. Your weekly timetable applies every day."; display:block; padding:16px; border:1px dashed #d7dfe8; border-radius:8px; font-size:13px; color:#67758a; }
.branch-action-dialog { width:min(520px,calc(100vw - 32px)); }.branch-action-warning { padding:16px; border:1px solid #eed7b4; background:#fff8eb; color:#715321; border-radius:10px; font-size:14px; line-height:1.6; margin-bottom:20px; }
.branch-dialog [hidden] { display:none!important; }
@media(max-width:700px){.branch-dialog-header,.branch-dialog-body{padding:18px}.branch-dialog-footer{padding:14px 18px}.branch-form-section{padding:14px}.branch-form-section .section-heading{flex-wrap:wrap;gap:12px}.branch-closure-row{grid-template-columns:1fr}.branch-closure-row button{justify-self:start}.branch-dialog .grid{gap:0}}
`;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const publicResponse=await publicBookingRoute(request,env);
      if(publicResponse)return publicResponse;
      const access = await accessGate(request, env);
      if (access.response) return access.response;
      const response = await application.fetch(request, env, { identity:access.user, waitUntil:(promise)=>ctx.waitUntil(promise) });
      const protectedResponse = await protectData(response, request, access.user, env);
      const headers = new Headers(protectedResponse.headers);
      headers.set("cache-control", "no-store");
      headers.set("x-frame-options", "DENY");
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "same-origin");
      return new Response(protectedResponse.body, { status:protectedResponse.status, headers });
    } catch (error) {
      console.error("Access request failed", error.message);
      return Response.json({ error:"Unable to complete the request. Please sign in again or contact an administrator." }, { status:500, headers:{"cache-control":"no-store"} });
    }
  }
};
