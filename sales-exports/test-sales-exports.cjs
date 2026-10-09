// Run with: node sales-exports/test-sales-exports.cjs
// Uses only Node built-ins and the application's preserved bundled SheetJS.
const fs = require("node:fs");
const path = require("node:path");
const original = fs.readFileSync(path.join(__dirname,"../backups/live-original-2026-10-09/main/index.js"),"utf8");
const candidate = fs.readFileSync(path.join(__dirname,"main/index.js"),"utf8");
const part=(source,name)=>{const marker=(name==="buildReportData"?"async ":"")+"function "+name+"(";const start=source.indexOf(marker);if(start<0)throw Error("Missing "+name);return source.slice(start,source.indexOf("__name(",start));};
if(part(candidate,"buildReportData")!==part(original,"buildReportData"))throw Error("Report queries, scope or allocation changed");
new Function(candidate.replace(/export \{\r?\n  index_default as default,\r?\n  getTimesheet,\r?\n  searchCustomers\r?\n\};/,""));
const library=original.slice(original.indexOf("var XLSX = {}"),original.indexOf("var headers22 ="));
const helper=candidate.slice(candidate.indexOf("function salesExportSheetName("),candidate.indexOf("async function exportReport("));
const dependencies=["reportDateRange","scopeReportSql","scopeReportParams","sydneyReportDate"].map(n=>part(original,n)).join("\n");
const harness="\nasync function buildFixture(raw,range,user){\n let queried=[];\n const all=async(env,sql,params=[])=>{\n   queried.push({sql,params});\n   let key=sql.includes(\"FROM sale_items\")?\"items\":sql.includes(\"FROM sales s\")?\"sales\":sql.includes(\"FROM bookings\")?\"bookings\":sql.includes(\"FROM time_entries\")?\"times\":sql.includes(\"FROM staff s\")?\"staff\":\"branches\";\n   if(key===\"staff\")return raw.staff;\n   return raw[key].filter(r=>{const branch=key===\"branches\"?r.id:r.branch_id;return (!range.branchId||range.branchId===branch)&&(user.allBranches||user.branchIds.includes(branch));});\n };\n const closeStaleTimeEntries=async()=>{};\n const reportHours=entry=>entry.clock_out?(Date.parse(entry.clock_out)-Date.parse(entry.clock_in))/3600000:0;\n __BUILD_REPORT_SOURCE__\n const report=await buildReportData({searchParams:{get:key=>range[key]||\"\"}}, {}, user);\n if(!user.allBranches && queried.filter(q=>!q.sql.includes(\"FROM staff s\")).some(q=>!q.sql.includes(\" IN (\")||q.params[q.params.length-1]!==user.branchIds[user.branchIds.length-1]))throw Error(\"Scope binding changed\");\n return report;\n}\n".replace("__BUILD_REPORT_SOURCE__",part(candidate,"buildReportData"));

async function runSalesExportTests(api) {
  const results=[], assert=(ok,label)=>{if(!ok)throw new Error(label);results.push(label);};
  const raw = {
    branches:[{id:"b1",name:"North / Salon"},{id:"b2",name:"South [Salon]"}],
    staff:[{id:"s1",name:"Alex / Staff with a very long shared name",role:"Manager",access_role:"manager"},{id:"s2",name:"Alex / Staff with a very long shared name",role:"Manager",access_role:"manager"}],
    sales:[
      {id:"sale1",branch_id:"b1",branch_name:"North / Salon",created_at:"2026-10-07T14:00:00Z",total_cents:10001},
      {id:"sale2",branch_id:"b2",branch_name:"South [Salon]",created_at:"2026-10-09T00:00:00Z",total_cents:2999},
      {id:"outside",branch_id:"b1",created_at:"2026-10-07T12:59:59Z",total_cents:77777}
    ],
    items:[
      {sale_id:"sale1",branch_id:"b1",branch_name:"North / Salon",created_at:"2026-10-07T14:00:00Z",service_id:"svc1",item_name:"Shared service",quantity:1,price_cents:10001,staff_ids:'["s1","s2"]',staff_allocations:'[{"staffId":"s1","amountCents":6001},{"staffId":"s2","amountCents":4000}]'},
      {sale_id:"sale2",branch_id:"b2",branch_name:"South [Salon]",created_at:"2026-10-09T00:00:00Z",item_name:"Retail",quantity:1,price_cents:2999,staff_ids:"[]"}
    ],
    bookings:[],
    times:[
      {id:"t1",staff_id:"s1",staff_name:"Alex",branch_id:"b1",branch_name:"North / Salon",clock_in:"2026-10-07T22:00:00Z",clock_out:"2026-10-08T01:00:00Z"},
      {id:"t2",staff_id:"s2",staff_name:"Alex",branch_id:"b1",branch_name:"North / Salon",clock_in:"2026-10-07T22:00:00Z",clock_out:"2026-10-08T01:00:00Z"}
    ]
  };
  const report=await api.build(raw,{from:"2026-10-08",to:"2026-10-09",branchId:""},{allBranches:true});
  assert(report.summary.revenueCents===13000 && report.summary.transactions===2,"Sydney boundaries and actual sale totals");
  const before=JSON.stringify(report);
  assert(report.staffDailyRows.length===2 && report.staffDailyRows.reduce((n,r)=>n+r.creditedSalesCents,0)===10001,"Shared staff allocation preserved to the cent");
  assert(report.managerDailyRows.reduce((n,r)=>n+r.revenueCents,0)===10001,"Odd-cent manager split reconciles");
  assert(report.managerDailyRows.reduce((n,r)=>n+r.branchRevenueCents,0)===20002,"Fixture exercises duplicated manager branch totals");
  for (const type of ["staff-daily","manager-daily","branch-daily","branch","staff"]) {
    const models=api.tables(report,type), wb=api.workbook(report,type);
    const bytes=api.write(wb), reopened=api.read(bytes);
    assert(reopened.SheetNames.length===3,type+": one summary plus two entity sheets");
    assert(new Set(reopened.SheetNames.map(n=>n.toLowerCase())).size===3,type+": unique sheet names");
    assert(reopened.SheetNames.every(n=>n.length<=31 && !/[\x00-\x1f\\/?*[\]:]/.test(n)),type+": safe Excel names");
    const total=models[0].tables.find(t=>t.title==="Selected period totals").rows[0];
    assert(total[3]===130 && total[4]===2,type+": summary avoids shared-sale double count");
    const days=models[0].tables.find(t=>t.title==="Sales totals by business date").rows;
    assert(days.length===2 && Math.round(days.reduce((n,r)=>n+r[1],0)*100)===13000,type+": date totals reconcile");
    for(let i=0;i<models.length;i++){
      const actual=api.aoa(reopened.Sheets[reopened.SheetNames[i]]);
      for(const section of models[i].tables){
        const titleIndex=actual.findIndex(r=>r[0]===section.title);
        assert(titleIndex>=0,type+": section survives XLSX round trip / "+section.title);
        const headers=actual[titleIndex+1].slice(0,section.headers.length);
        assert(JSON.stringify(headers)===JSON.stringify(section.headers),type+": all original section fields retained / "+section.title);
        for(let r=0;r<section.rows.length;r++){
          const expected=section.rows[r].map((v,col)=>section.dates.includes(col)&&v?(Date.parse(v+"T00:00:00Z")-Date.UTC(1899,11,30))/86400000:v);
          const got=actual[titleIndex+2+r].slice(0,section.headers.length).map(v=>v instanceof Date?(v.getTime()-Date.UTC(1899,11,30))/86400000:v);
          assert(JSON.stringify(got)===JSON.stringify(expected),type+": record survives XLSX round trip / "+section.title+" / "+r);
        }
      }
    }
    const first=reopened.Sheets[reopened.SheetNames[1]];
    assert(Object.values(first).some(c=>c && c.z==='"$"#,##0.00'),type+": currency number format");
    assert(Object.values(first).some(c=>c && c.z==="yyyy-mm-dd"),type+": sortable business dates");
  }
  assert(JSON.stringify(report)===before,"Export does not mutate report records");
  const used=new Set(["summary"]), hostile=["Summary","summary","History","  'Quoted'  ","","[]:*?/\\","x".repeat(30)+"'tail","😀".repeat(30),"NAME","name"];
  const names=hostile.map(n=>api.name(n,used));
  assert(names.every(n=>n.length>0&&n.length<=31&&!/^'|'$|[\x00-\x1f\\/?*[\]:]/.test(n)),"Empty, invalid, apostrophe and Unicode sheet names");
  assert(new Set(names.map(n=>n.toLowerCase())).size===names.length,"Case-insensitive duplicate name collisions");
  const none={range:{from:"2026-10-08",to:"2026-10-09",branchId:""},summary:{revenueCents:0,transactions:0,productsSold:0,servicesSold:0,onlineBookings:0,walkIns:0,workedHours:0},branchRows:[],staffRows:[],staffDailyRows:[],managerDailyRows:[],branchDailyRows:[]};
  for(const type of ["staff","staff-daily","manager-daily","branch","branch-daily"]){
    const wb=api.read(api.write(api.workbook(none,type)));
    assert(wb.SheetNames.join("|")==="Summary|No records",type+": no-results workbook");
  }
  const scoped=await api.build(raw,{from:"2026-10-08",to:"2026-10-09",branchId:""},{allBranches:false,branchIds:["b2"]});
  assert(scoped.summary.revenueCents===2999 && scoped.summary.transactions===1,"Authorized branch scope retained");
  assert(api.tables(scoped,"branch").length===2,"Unauthorized branch sheet excluded");
  const selected=await api.build(raw,{from:"2026-10-09",to:"2026-10-09",branchId:"b2"},{allBranches:true});
  assert(selected.summary.revenueCents===2999 && selected.branchDailyRows.length===1,"Selected date and branch filters retained");
  const refund=JSON.parse(JSON.stringify(none));refund.summary.revenueCents=-101;refund.summary.transactions=1;refund.branchDailyRows=[{date:"2026-10-08",branchId:"b",branch:"Refund",revenueCents:-101,transactions:1,productsSold:0,servicesSold:0}];
  assert(api.tables(refund,"branch-daily")[1].tables[0].rows[0][2]===-1.01,"Negative sale amounts preserved");

  const multi=JSON.parse(JSON.stringify(raw));
  for(const [id,date,cents] of [["sale3","2026-10-08T00:00:00Z",101],["sale4","2026-10-09T01:00:00Z",202]]){
    multi.sales.push({id,branch_id:"b2",branch_name:"South [Salon]",created_at:date,total_cents:cents});
    multi.items.push({sale_id:id,branch_id:"b2",branch_name:"South [Salon]",created_at:date,service_id:"svc",quantity:1,price_cents:cents,staff_ids:'["s1"]',staff_allocations:"[]"});
  }
  const multiReport=await api.build(multi,{from:"2026-10-08",to:"2026-10-09",branchId:""},{allBranches:true});
  const staffSheet=api.tables(multiReport,"staff-daily").find(s=>s.notes.includes("Record identity: s1"));
  const daily=staffSheet.tables.find(t=>t.title==="Staff totals by business date").rows;
  assert(daily.length===2 && daily[0][1]===61.02 && daily[1][1]===2.02,"Per-staff date totals combine multiple branches without losing dates");
  assert(staffSheet.tables.find(t=>t.title==="Staff records by business date").rows.length===3,"Multiple dates and branches retain every staff record");
  assert(multiReport.summary.revenueCents===13303 && multiReport.summary.transactions===4,"Multiple-date multi-branch summary reconciles");
  const duplicates=JSON.parse(JSON.stringify(multiReport));
  duplicates.branchRows.forEach(r=>r.branch="Same / branch");
  const duplicateBook=api.read(api.write(api.workbook(duplicates,"branch")));
  assert(duplicateBook.SheetNames.length===3 && duplicateBook.SheetNames[1]!==duplicateBook.SheetNames[2],"Different branch IDs with duplicate names stay separate");
  const negativeManager=JSON.parse(JSON.stringify(raw));
  negativeManager.sales[0].total_cents=-101;
  const negativeReport=await api.build(negativeManager,{from:"2026-10-08",to:"2026-10-08",branchId:"b1"},{allBranches:true});
  assert(negativeReport.managerDailyRows.reduce((s,r)=>s+r.revenueCents,0)===-101,"Negative odd-cent manager allocations retained");

  return {checks:results.length,results};
}

const runner=["const __name=x=>x,__name2=__name,__name22=__name;const clean=v=>String(v||'').trim();",library,dependencies,helper,harness,runSalesExportTests.toString(),"\nreturn runSalesExportTests({build:buildFixture,tables:salesExportTables,workbook:salesExportWorkbook,name:salesExportSheetName,write:w=>writeSync(w,{type:\"array\",bookType:\"xlsx\",compression:true}),read:b=>readSync(b,{type:\"array\",cellNF:true}),aoa:s=>utils.sheet_to_json(s,{header:1,defval:null,blankrows:true})});\n"].join("\n");
new Function(runner)().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
