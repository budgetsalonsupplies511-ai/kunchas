import * as XLSX from 'xlsx';
const headers=['Service ID','Name','Category','Sub-category','Duration minutes','Price','Status'];
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const text=value=>String(value??'').trim();
const key=service=>JSON.stringify([service.name,service.category,service.sub_category].map(value=>text(value).toLowerCase()));
export async function exportServices(env){
  const {results}=await env.DB.prepare('SELECT * FROM services ORDER BY category, sub_category, name').all();
  const rows=[headers,...results.map(s=>[s.id,s.name,s.category,s.sub_category,s.duration_minutes,s.price_cents/100,s.status])];
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols']=[{wch:44},{wch:30},{wch:24},{wch:24},{wch:20},{wch:14},{wch:14}];
  sheet['!autofilter']={ref:'A1:G'+rows.length};
  for(let i=2;i<=rows.length;i++)sheet['F'+i].z='"$"#,##0.00';
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'Services');
  return new Response(XLSX.write(workbook,{type:'array',bookType:'xlsx',compression:true}),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':'attachment; filename="kunchas-services-'+new Date().toISOString().slice(0,10)+'.xlsx"','cache-control':'no-store','x-content-type-options':'nosniff'}});
}
export async function importServices(request,env){
  const bytes=await request.arrayBuffer();
  if(!bytes.byteLength)return json({error:'Choose an Excel workbook to import.'},400);
  if(bytes.byteLength>5*1024*1024)return json({error:'The workbook must be smaller than 5 MB.'},413);
  let workbook;try{workbook=XLSX.read(new Uint8Array(bytes),{type:'array',cellDates:false});}catch{return json({error:'The selected file could not be read as an Excel workbook.'},400);}
  const sheet=workbook.Sheets.Services||workbook.Sheets[workbook.SheetNames[0]];
  const rows=sheet?XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true}):[];
  if(rows.length<2)return json({error:'The workbook has no service rows. Export Excel to get the column template.'},400);
  if(rows.length>1001)return json({error:'Import up to 1,000 services at a time.'},400);
  const cols=rows[0].map(value=>text(value).toLowerCase().replace(/[-_]/g,' '));
  const get=(row,...names)=>{const index=cols.findIndex(col=>names.includes(col));return index<0?'':row[index];};
  if(!cols.includes('name')&&!cols.includes('service name'))return json({error:'Missing Name column. Use the exported Services template.'},400);
  const {results}=await env.DB.prepare('SELECT * FROM services').all();
  const services=new Map(results.map(s=>[s.id,s]));const seen=new Set();
  let created=0,updated=0,skipped=0;const errors=[];
  for(let i=1;i<rows.length;i++){
    const row=rows[i];if(row.every(value=>text(value)===''))continue;
    const fail=message=>{skipped++;errors.push('Row '+(i+1)+': '+message);};
    const id=text(get(row,'service id','id'));
    const s={name:text(get(row,'name','service name')),category:text(get(row,'category')),sub_category:text(get(row,'sub category','subcategory')),duration_minutes:Number(get(row,'duration minutes','duration')),price_cents:Math.round(Number(get(row,'price','price $','retail price'))*100),status:text(get(row,'status'))||'Active'};
    s.status=s.status.toLowerCase()==='active'?'Active':s.status.toLowerCase()==='inactive'?'Inactive':s.status;
    if(!s.name||!s.category||!s.sub_category||!Number.isSafeInteger(s.duration_minutes)||s.duration_minutes<1||!Number.isSafeInteger(s.price_cents)||s.price_cents<1||!['Active','Inactive'].includes(s.status)){fail('Enter name, category, sub-category, positive whole duration, positive price, and Active or Inactive status.');continue;}
    let existing=id?services.get(id):null;
    if(id&&!existing){fail('Service ID was not found. Leave it blank to add a new service.');continue;}
    if(!id){const matches=[...services.values()].filter(item=>key(item)===key(s));if(matches.length>1){fail('Multiple services match. Include the Service ID from an export.');continue;}existing=matches[0];}
    const target=existing?.id||'service-'+crypto.randomUUID();
    if(seen.has(target)){fail('This service appears more than once in the workbook.');continue;}
    seen.add(target);
    if(existing){await env.DB.prepare('UPDATE services SET name=?, category=?, sub_category=?, duration_minutes=?, price_cents=?, status=? WHERE id=?').bind(s.name,s.category,s.sub_category,s.duration_minutes,s.price_cents,s.status,target).run();updated++;}
    else{await env.DB.prepare('INSERT INTO services (id,name,category,sub_category,duration_minutes,price_cents,status) VALUES (?,?,?,?,?,?,?)').bind(target,s.name,s.category,s.sub_category,s.duration_minutes,s.price_cents,s.status).run();created++;}
    services.set(target,{...s,id:target});
  }
  return json({ok:true,created,updated,skipped,errors:errors.slice(0,20)});
}
