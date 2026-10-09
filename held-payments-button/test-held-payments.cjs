// Run: node held-payments-button/test-held-payments.cjs
// Isolated UI/network mocks; does not access production or real device storage.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const source=fs.readFileSync(path.join(__dirname,"main/index.js"),"utf8");
const data=JSON.parse(fs.readFileSync(path.join(__dirname,"patches.json"),"utf8"));
new Function(source.slice(0,source.lastIndexOf("\nexport {")));
new Function(new Function(source.slice(0,source.lastIndexOf("\nexport {"))+";return clientScript();")());
assert.ok(source.includes(data.helpers.replace(/\r?\n/g,"\r\n")));
async function testHeldButton(source, helperSource) {
  let checks=0; const results=[];
  const ok=(v,label)=>{if(!v)throw Error(label);checks++;results.push(label)};
  const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()};
  function setup() {
    const nodes = {};
    const node = id => nodes[id] ||= {textContent:"",innerHTML:"",value:"",hidden:false,disabled:false,classList:{remove(){}},querySelectorAll(){return[]}};
    let requestCount=0, readCount=0, writeCount=0, nextFetch=async()=>response([]), local=[], queue=[], resumeCalls=0, resumeGate=null;
    const response=(holds,status=200,contentType="application/json",redirected=false)=>({ok:status===200,status,redirected,headers:{get:()=>contentType},json:async()=>({heldSales:holds})});
    const context={document:{querySelector:node},appMode:"staff",selectedPosBranchId:"branch-hurstville",heldSales:[],fetch:async(url,options)=>{requestCount++;ok(options.method==="GET","List request is read-only GET");ok(options.headers["x-branch-id"]==="branch-hurstville"&&options.headers["x-pos-workspace"]==="1","Staff and branch headers supplied");return nextFetch(url,options)},AbortController:class{signal={};abort(){}},setTimeout:()=>1,clearTimeout:()=>{},offlineLoad:async()=>{readCount++;return local},offlineQueue:async()=>queue,esc:s=>String(s||""),money:c=>"$"+(c/100).toFixed(2),setSaleMessage:()=>{},resumeHeldSaleDraft:async()=>{resumeCalls++;if(resumeGate)await resumeGate},TypeError};
    const api=new Function(...Object.keys(context),helperSource+';return {loadHeldSales,fetchCloudHeldSales,renderHeldSales,resumeHeldSale,branch:v=>selectedPosBranchId=v,get:()=>({heldSales,heldListError,heldListBusy,heldListLoaded,heldListPendingCount})};')(...Object.values(context));
    return {api,nodes,node,response,setFetch:f=>nextFetch=f,setLocal:v=>local=v,setQueue:v=>queue=v,setResumeGate:p=>resumeGate=p,stats:()=>({requestCount,readCount,writeCount,resumeCalls})};
  }
  const hold={id:"h1",branch_id:"branch-hurstville",customer_name:"Test",customer_phone:"",total_cents:45900,updated_at:"2026-10-09T01:42:37Z",payload:{items:[{}]}};
  let h=setup(), resolveFetch;
  h.setFetch(()=>new Promise(resolve=>resolveFetch=resolve));
  const first=h.api.loadHeldSales();await tick();
  ok(h.node("#heldSalesStatus").textContent.includes("Loading"),"Loading status displayed");
  ok(h.node("#loadHeldSalesButton").disabled,"Repeated click disabled during request");
  await h.api.loadHeldSales();ok(h.stats().requestCount===1,"Repeated requests deduplicated");
  resolveFetch(h.response([hold]));await first;
  ok(h.api.get().heldSales[0].id==="h1","Cloud hold preserves original ID");
  ok(h.node("#heldSalesList").innerHTML.includes("Cloud saved"),"Cloud result explicitly labelled");
  ok(!h.node("#loadHeldSalesButton").disabled,"Button enabled after success");
  h.node("#heldSalesSearch").value="absent";h.api.renderHeldSales();
  ok(h.node("#heldSalesList").innerHTML.includes("No matching"),"Search mismatch distinct from empty cloud");
  h=setup();await h.api.loadHeldSales();ok(h.node("#heldSalesStatus").textContent.includes("No held payments saved"),"Successful empty result explicitly shown");
  for(const kind of ["network","login","redirect","401","malformed","wrongBranch","device"]) {
    h=setup();
    h.setFetch(async()=>{
      if(kind==="network")throw new TypeError("Failed to fetch");
      if(kind==="login")return h.response([],200,"text/html");
      if(kind==="redirect")return h.response([],200,"application/json",true);
      if(kind==="401")return h.response([],401);
      if(kind==="malformed")return h.response(null);
      if(kind==="wrongBranch")return h.response([{...hold,branch_id:"branch-blacktown"}]);
      return h.response([hold]);
    });
    if(kind==="device")h.setLocal({});
    await h.api.loadHeldSales();
    ok(!!h.api.get().heldListError,kind+": explicit error");
    ok(!h.node("#retryHeldSales").hidden&&!h.node("#retryHeldSales").disabled,kind+": retry available");
    ok(!h.node("#heldSalesStatus").textContent.includes("No held payments saved"),kind+": never presented as an empty cloud");
  }
  h=setup();h.setFetch(async()=>h.response([hold]));h.setQueue([{payload:{heldSaleId:"h1"}}]);await h.api.loadHeldSales();
  ok(h.api.get().heldSales.length===0&&h.api.get().heldListPendingCount===1,"Pending checkout hold excluded");
  ok(h.node("#heldSalesStatus").textContent.includes("checkout pending"),"Hidden pending checkout clearly explained");
  h=setup();h.setFetch(()=>new Promise(resolve=>resolveFetch=resolve));const changing=h.api.loadHeldSales();await tick();h.api.branch("branch-blacktown");resolveFetch(h.response([hold]));await changing;
  ok(h.api.get().heldListError.includes("branch changed")&&h.api.get().heldSales.length===0,"Stale branch response cannot populate list");
  h=setup();h.setFetch(async()=>{throw new TypeError("offline")});await h.api.loadHeldSales();h.setFetch(async()=>h.response([hold]));await h.api.loadHeldSales();
  ok(!h.api.get().heldListError&&h.api.get().heldSales.length===1,"Retry recovers without rewriting records");
  let finishResume;h.setResumeGate(new Promise(resolve=>finishResume=resolve));
  const opening=h.api.resumeHeldSale("h1");await tick();await h.api.resumeHeldSale("h1");
  ok(h.stats().resumeCalls===1,"Repeated opening is serialized");finishResume();await opening;
  h.api.branch("branch-blacktown");await h.api.resumeHeldSale("h1");ok(h.stats().resumeCalls===1,"Wrong-branch resume blocked");

  const a=source.indexOf("async function resumeHeldSaleDraft(");
  const next=source.slice(a+1).search(/\r?\n(?:async )?function /);
  const resumeSource=source.slice(a,a+1+next);
  for(const mode of ["cart","processing","empty"]) {
    let resets=0, confirms=0;
    const form={dataset:mode==="processing"?{processing:"true"}:{},elements:{saleNote:{value:mode==="cart"?"Keep me":""}},querySelectorAll:()=>[],reset(){resets++;throw Error("STOP_AFTER_ALLOWED_RESET")}};
    const context={heldSales:[{...hold,payload:{items:[]}}],selectedPosBranchId:"branch-hurstville",document:{querySelector:()=>form},state:{bookings:[],customers:[]},saleCatalog:()=>[],salePayments:[],window:{confirm:()=>{confirms++;return false}},setSaleMessage:()=>{}};
    const resume=new Function(...Object.keys(context),resumeSource+";return resumeHeldSaleDraft;")(...Object.values(context));
    try{await resume("h1")}catch(e){if(e.message!=="STOP_AFTER_ALLOWED_RESET")throw e}
    if(mode==="cart")ok(confirms===1&&resets===0,"Declining replacement preserves a notes-only cart");
    if(mode==="processing")ok(confirms===0&&resets===0,"Payment in progress blocks resume");
    if(mode==="empty")ok(resets===1,"Empty cart may open a selected hold");
  }
  return {checks,results};
}
testHeldButton(source,data.helpers).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
