function salesExportSheetName(label, used) {
  const cleanName = String(label || "").replace(/[\x00-\x1f\x7f\\/?*[\]:]/g, " ").trim().replace(/^'+|'+$/g, "").trim() || "Sheet";
  const shorten = (value, length) => { let out = ""; for (const char of value) { if (out.length + char.length > length) break; out += char; } return out; };
  const base = cleanName.toLowerCase() === "history" ? "History report" : cleanName;
  let suffix = "", candidate = shorten(base, 31).replace(/\'+$/g, "") || "Sheet", count = 1;
  while (used.has(candidate.toLowerCase())) { suffix = " (" + (++count) + ")"; candidate = shorten(base, 31 - suffix.length) + suffix; }
  used.add(candidate.toLowerCase());
  return candidate;
}
function salesExportSum(rows, key) {
  return rows.reduce((sum, row) => {
    const value = Number(row[key] || 0);
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(sum + value)) throw new Error("Invalid or oversized report total: " + key);
    return sum + value;
  }, 0);
}
function salesExportTables(report, type) {
  const sum = salesExportSum;
  const byDate = (rows) => {
    const groups = new Map();
    rows.forEach(row => { const date = row.date || ""; if (!groups.has(date)) groups.set(date, []); groups.get(date).push(row); });
    return [...groups].sort(([a],[b]) => a.localeCompare(b));
  };
  const sortRows = rows => [...rows].sort((a,b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.branch || "").localeCompare(String(b.branch || "")));
  const staffHeader = ["Date", "Staff", "Role", "Branch", "Credited Sales", "Services Credited", "Transactions"];
  const managerHeader = ["Date", "Manager", "Branch", "Branch Sales", "Managers Clocked In", "Manager Share", "Branch Transactions"];
  const branchHeader = ["Date", "Branch", "Total Sales", "Transactions", "Products Sold", "Services Sold"];
  const staffDetail = rows => rows.map(row => [row.date,row.staff,row.role,row.branch,row.creditedSalesCents / 100,row.serviceItems,row.transactions]);
  const managerDetail = rows => rows.map(row => [row.date,row.manager,row.branch,row.branchRevenueCents / 100,row.managerCount,row.revenueCents / 100,row.transactions]);
  const branchDetail = rows => rows.map(row => [row.date,row.branch,row.revenueCents / 100,row.transactions,row.productsSold,row.servicesSold]);
  const table = (title, headers, rows, currency = [], dates = [], filter = false) => ({title,headers,rows,currency,dates,filter});
  const summary = {
    name: "Summary",
    title: "Total sales — selected report scope",
    notes: [
      "Business dates: Australia/Sydney. Totals use the selected date and authorized branch filters.",
      "Total sales and transactions count each sale once. Staff credited sales and manager shares are separate attribution measures; do not add them to total sales.",
      "Staff service credits and staff transaction counts may repeat across people sharing a sale. Manager branch sales and branch transactions repeat across managers.",
      "Existing staff allocation and rounding rules are preserved; credited sales need not equal sale revenue (for example, unassigned items or discounts)."
    ],
    tables: [
      table("Selected period totals", ["From","To","Branch filter","Total Sales","Transactions","Products Sold","Services Sold","Online Bookings","Walk-ins","Worked Hours"],
        [[report.range.from,report.range.to,report.range.branchId || "All authorized branches",report.summary.revenueCents / 100,report.summary.transactions,report.summary.productsSold,report.summary.servicesSold,report.summary.onlineBookings,report.summary.walkIns,report.summary.workedHours]], [3], [0,1]),
      table("Sales totals by business date", ["Date","Total Sales","Transactions","Products Sold","Services Sold"],
        byDate(report.branchDailyRows).map(([date,rows]) => [date,sum(rows,"revenueCents")/100,sum(rows,"transactions"),sum(rows,"productsSold"),sum(rows,"servicesSold")]), [1], [0]),
      table("Attribution totals (not additional sales)", ["Credited Staff Sales","Manager Share"],
        [[sum(report.staffDailyRows,"creditedSalesCents")/100,sum(report.managerDailyRows,"revenueCents")/100]], [0,1])
    ]
  };
  const sheets = [summary], groups = new Map();
  const group = (id, name) => { const key = String(id || name || "Unassigned"); if (!groups.has(key)) groups.set(key,{id:key,name:name || "Unassigned",staff:[],manager:[],branch:[],overall:null}); return groups.get(key); };
  if (type === "branch" || type === "branch-daily") {
    report.branchRows.forEach(row => { group(row.branchId,row.branch).overall = row; });
    report.branchDailyRows.forEach(row => group(row.branchId,row.branch).branch.push(row));
  } else if (type === "staff") {
    report.staffRows.forEach(row => { group(row.staffId,row.staff).overall = row; });
    report.staffDailyRows.forEach(row => group(row.staffId,row.staff).staff.push(row));
    report.managerDailyRows.forEach(row => group(row.staffId,row.manager).manager.push(row));
  } else if (type === "staff-daily") {
    report.staffDailyRows.forEach(row => group(row.staffId,row.staff).staff.push(row));
  } else if (type === "manager-daily") {
    report.managerDailyRows.forEach(row => group(row.staffId,row.manager).manager.push(row));
  }
  const staffTables = rows => [
    table("Staff period totals", ["Credited Sales","Services Credited","Transactions"], [[sum(rows,"creditedSalesCents")/100,sum(rows,"serviceItems"),sum(rows,"transactions")]], [0]),
    table("Staff totals by business date", ["Date","Credited Sales","Services Credited","Transactions"], byDate(rows).map(([date,day]) => [date,sum(day,"creditedSalesCents")/100,sum(day,"serviceItems"),sum(day,"transactions")]), [1], [0]),
    table("Staff records by business date", staffHeader, staffDetail(sortRows(rows)), [4], [0], true)
  ];
  const managerTables = rows => [
    table("Manager period totals", ["Branch Sales","Manager Share","Branch Transactions"], [[sum(rows,"branchRevenueCents")/100,sum(rows,"revenueCents")/100,sum(rows,"transactions")]], [0,1]),
    table("Manager totals by business date", ["Date","Branch Sales","Manager Share","Branch Transactions"], byDate(rows).map(([date,day]) => [date,sum(day,"branchRevenueCents")/100,sum(day,"revenueCents")/100,sum(day,"transactions")]), [1,2], [0]),
    table("Manager records by business date", managerHeader, managerDetail(sortRows(rows)), [3,5], [0], true)
  ];
  [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).forEach(g => {
    const sheet = {name:g.name,title:g.name,notes:["From " + report.range.from + " to " + report.range.to + " | Business dates: Australia/Sydney", "Record identity: " + g.id],tables:[]};
    if (type === "branch" || type === "branch-daily") {
      if (g.overall) { const r=g.overall; sheet.tables.push(table("Branch period totals", ["Branch","Sales","Transactions","Products Sold","Services Sold","Online Bookings","Manual Bookings","Walk-ins"], [[r.branch,r.revenueCents/100,r.transactions,r.productsSold,r.servicesSold,r.onlineBookings,r.manualBookings,r.walkIns]], [1])); }
      sheet.tables.push(table("Branch totals and records by business date", branchHeader, branchDetail(sortRows(g.branch)), [2], [0], true));
    } else {
      if (g.overall) { const r=g.overall; sheet.tables.push(table("Staff and manager period totals", ["Staff","Role","Credited Sales","Services Sold","Manager Share"], [[r.staff,r.role,r.creditedSalesCents/100,r.serviceItems,r.managerStoreSalesCents/100]], [2,4])); }
      if (type === "staff" || type === "staff-daily") sheet.tables.push(...staffTables(g.staff));
      if (type === "manager-daily" || type === "staff" && g.manager.length) sheet.tables.push(...managerTables(g.manager));
      sheet.notes.push("Attribution only: do not add credited sales or manager shares to the Summary total. Shared-service counts are participation counts.");
    }
    if (![...g.staff,...g.manager,...g.branch].length) sheet.notes.push("No sales records for this selection.");
    sheets.push(sheet);
  });
  if (!groups.size) sheets.push({name:"No records",title:"No records",notes:["No matching records for the selected dates and authorized branches."],tables:[table("Records by business date",type==="manager-daily"?managerHeader:type.startsWith("branch")?branchHeader:staffHeader,[])]});
  return sheets;
}
function salesExportWorkbook(report, type) {
  const workbook = utils.book_new(), used = new Set();
  for (const spec of salesExportTables(report,type)) {
    const rows = [[spec.title],...spec.notes.map(note=>[note]),[]], sections = [];
    for (const table of spec.tables) {
      rows.push([table.title]);
      const headerRow = rows.length;
      rows.push(table.headers);
      const dataStart = rows.length;
      rows.push(...table.rows.map(values => values.map((value,index) => {
        if (!table.dates.includes(index) || !value) return value;
        return (Date.parse(String(value)+"T00:00:00Z") - Date.UTC(1899,11,30)) / 86400000;
      })));
      if (!table.rows.length) rows.push(["No records"]);
      sections.push({table,headerRow,dataStart});
      rows.push([]);
    }
    const sheet = utils.aoa_to_sheet(rows);
    const width = Math.max(...spec.tables.map(t=>t.headers.length),1);
    sheet["!cols"] = Array.from({length:width},(_,col)=>({wch:Math.min(44,Math.max(col===0?26:18,...spec.tables.map(t=>String(t.headers[col]||"").length+2)))}));
    sections.forEach(({table,headerRow,dataStart}) => {
      table.rows.forEach((_,rowIndex) => {
        [...table.currency,...table.dates].forEach(column=>{
          const cell=sheet[utils.encode_cell({r:dataStart+rowIndex,c:column})];
          if (cell && typeof cell.v==="number") cell.z=table.dates.includes(column)?"yyyy-mm-dd":'"$"#,##0.00';
        });
      });
      if (table.filter && table.rows.length) sheet["!autofilter"]={ref:utils.encode_range({s:{r:headerRow,c:0},e:{r:dataStart+table.rows.length-1,c:table.headers.length-1}})};
    });
    utils.book_append_sheet(workbook,sheet,salesExportSheetName(spec.name,used));
  }
  return workbook;
}
function salesExportResponse(report,type) {
  const workbook = salesExportWorkbook(report,type);
  const output = writeSync(workbook,{type:"array",bookType:"xlsx",compression:true});
  return new Response(output,{headers:{"content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","content-disposition":'attachment; filename="kunchas-'+type+'-'+report.range.from+'-to-'+report.range.to+'.xlsx"',"cache-control":"no-store"}});
}
