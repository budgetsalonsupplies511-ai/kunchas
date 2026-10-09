// Run: node held-payments/test-held-payments.cjs
// Isolated behavioral tests with mocked browser storage/network; no production writes.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const data = JSON.parse(fs.readFileSync(path.join(__dirname,"patches.json"),"utf8"));
const source = fs.readFileSync(path.join(__dirname,"main/index.js"),"utf8");
for (const change of [...data.changes,...data.extras]) assert.ok(source.includes(change.replacement), "Missing replacement: "+change.name);
assert.ok(source.includes(data.helpers.replace(/\r?\n/g,"\r\n")));
new Function(source.slice(0,source.lastIndexOf("\nexport {")));

async function runHeldTests(patches, helpers) {
  const TextDecoder = class { decode(){ return "[]"; } };
  let checks=0; const results=[];
  function ok(value,label){if(!value)throw Error(label);checks++;results.push(label)}
  async function rejects(p,label){let rejected=false;try{await p}catch{rejected=true}ok(rejected,label)}
  const tick=async()=>{await Promise.resolve();await Promise.resolve();};
  function rawHarness(){
    let req={},tx={objectStore:()=>({put:()=>req,get:()=>req})},closed=0;
    const fn=new Function("offlineDb",patches.offlineRaw+";return offlineRaw;")(async()=>({transaction:()=>tx,close:()=>closed++}));
    return {fn,req,tx,closed:()=>closed};
  }
  let r=rawHarness(),done=false,p=r.fn("x",{a:1}).then(()=>done=true);
  await tick();r.req.result="x";r.req.onsuccess();await tick();ok(!done,"Local write waits for transaction completion");
  r.tx.oncomplete();await p;ok(done&&r.closed()===1,"Committed local write resolves and closes database");
  r=rawHarness();p=r.fn("x",{});await tick();r.req.onsuccess();r.tx.error=Error("abort");r.tx.onabort();await rejects(p,"Abort after request success rejects save");
  r=rawHarness();p=r.fn("x");await tick();r.req.result={a:1};r.req.onsuccess();r.tx.oncomplete();ok((await p).a===1,"Local read returns value after commit");
  r=rawHarness();p=r.fn("x",{});await tick();r.req.error=Error("quota");r.req.onerror();await rejects(p,"Quota/request errors reject without save confirmation");
  let generated=0;
  const loadFn=new Function("offlineRaw","crypto","TextDecoder",patches.offlineLoad+";return offlineLoad;")(
    async key=>key==="device-key"?undefined:{iv:[1],encrypted:[2]},
    {subtle:{decrypt:()=>{generated++;throw Error("must not decrypt")}}},TextDecoder);
  await rejects(loadFn("held"),"Missing encryption key rejects existing record");ok(generated===0,"Missing-key read never creates or replaces a key");
  const corruptFn=new Function("offlineRaw","crypto","TextDecoder",patches.offlineLoad+";return offlineLoad;")(
    async key=>key==="device-key"?{}:{iv:[1],encrypted:[2]}, {subtle:{decrypt:async()=>{throw Error("decrypt")}}},TextDecoder);
  await rejects(corruptFn("held"),"Decryption failure propagates rather than becoming empty data");
  const helperEnv=new Function("navigator","offlineLoad",helpers+";return {heldApiResult,heldStorageRows,heldStorageLock};")({},async()=>({invalid:true}));
  await rejects(helperEnv.heldStorageRows("held"),"Invalid local list is never treated as empty");
  const response=(status,type,body,redirected=false)=>({status,ok:status>=200&&status<300,redirected,headers:{get:()=>type},json:async()=>body});
  const post={method:"POST",body:JSON.stringify({id:"hold-1"})};
  ok((await helperEnv.heldApiResult(response(200,"application/json",{ok:true,id:"hold-1"}),post)).ok,"Matching cloud acknowledgement accepted");
  await rejects(helperEnv.heldApiResult(response(200,"application/json",{ok:true,id:"wrong"}),post),"Wrong cloud acknowledgement ID rejected");
  await rejects(helperEnv.heldApiResult(response(200,"text/html",{}),post),"Cloudflare HTML login response rejected as authentication");
  await rejects(helperEnv.heldApiResult(response(200,"application/json",{},true),post),"Redirected response never confirms a hold");
  try{await helperEnv.heldApiResult(response(401,"application/json",{error:"Open branch with PIN"}),post)}catch(e){ok(e.authRequired&&e.message.includes("Open branch with PIN"),"App PIN expiry retains accurate authentication message")}
  await rejects(helperEnv.heldApiResult(response(200,"application/json",{}),{}),"Malformed held list rejected");
  let order=[];await Promise.all([helperEnv.heldStorageLock("b",async()=>{order.push(1);await tick();order.push(2)}),helperEnv.heldStorageLock("b",async()=>order.push(3))]);ok(order.join()==="1,2,3","Same-page held writes are serialized");
  function holdHarness(mode){
    const data={branchId:"b",customerMode:"guest",checkoutMode:"walkin"};
    const form={dataset:{},elements:{branchId:{}},querySelectorAll:()=>[],reset(){this.resetCount++;},resetCount:0};
    let ids=[],saved=[],messages=[],loadCalls=0;
    const fields={"#saleForm":form,"#holdSaleButton":{},"#saleItems":{},"#bookingCheckoutSearch":{},"#bookingCustomerCard":{classList:{add(){}}}};
    const api=async(path,options)=>{ids.push(JSON.parse(options.body).id); if(mode==="auth")throw Object.assign(Error("sign in"),{status:401,authRequired:true});if(["offline","badLocal","abort"].includes(mode))throw new TypeError("Failed to fetch");return {ok:true}};
    const context={
      document:{querySelector:s=>fields[s]},FormData:class{get(k){return data[k]||""}},setSaleMessage:(s)=>messages.push(s),salePayments:[],state:{bookings:[],customers:[]},findCustomerId:()=>"",
      saleDraftItems:()=>[{itemType:"product",itemId:"p"}],allocationError:()=>null,checkoutPricing:()=>{},checkoutDiscount:()=>({}),saleTotalCents:()=>100,
      crypto:{randomUUID:()=> "stable-id"},api,removeLocalHeldSale:async()=>{},offlineNetworkError:e=>e instanceof TypeError,appMode:"staff",
      heldStorageLock:async(b,f)=>f(),heldStorageRows:async()=>{if(mode==="badLocal")throw Error("unreadable");return []},
      offlineSave:async(k,v)=>{if(mode==="abort")throw Error("aborted");saved.push(v)},
      selectedPosBranchId:"b",updateCheckoutMode(){},updateCustomerMode(){},resetPaymentUi(){},renderCartSummary(){},
      loadHeldSales:async()=>{loadCalls++},updateOfflineStatus:async()=>{},heldLoadError:mode==="listFail"?"login required":""
    };
    const fn=new Function(...Object.keys(context),patches.holdCurrentSale+";return holdCurrentSale;")(...Object.values(context));
    return {fn,form,ids,saved,messages,loadCalls:()=>loadCalls};
  }
  for(const mode of ["auth","badLocal","abort"]){const h=holdHarness(mode);await h.fn();ok(h.form.resetCount===0,mode+": unsuccessful save preserves cart");ok(h.form.dataset.holdAttemptId==="stable-id",mode+": retry ID retained");await h.fn();ok(h.ids[0]===h.ids[1],mode+": retry uses same cloud ID")}
  let h=holdHarness("offline");await h.fn();ok(h.saved.length===1&&h.form.resetCount===1,"Local fallback clears only after confirmed local save");ok(h.messages.at(-1).includes("cloud save is NOT confirmed"),"Local-only status explicitly denies cloud confirmation");
  h=holdHarness("cloud");await h.fn();ok(h.form.resetCount===1&&h.messages.at(-1).startsWith("Cloud save confirmed"),"Cloud success clears cart and confirms cloud storage");
  h=holdHarness("listFail");await h.fn();ok(h.messages.at(-1).includes("Cloud save confirmed")&&h.messages.at(-1).includes("list could not be refreshed"),"Cloud save and list reload failure are distinguished");
  let remoteWrites=0,rendered=0,known=[{id:"existing",branch_id:"b"}];
  const loadContext={selectedPosBranchId:"b",appMode:"staff",heldStorageRows:async()=>{throw Error("decrypt failed")},api:async()=>{remoteWrites++},offlineLoad:async()=>[],offlineSave:async()=>{},offlineNetworkError:()=>false,offlineQueue:async()=>[],renderHeldSales:()=>rendered++,message:{},heldSales:known};
  const loadHeld=new Function(...Object.keys(loadContext),'let heldLoadError="";'+patches.loadHeldSales+";return async()=>({ok:await loadHeldSales(),heldSales});")(...Object.values(loadContext));
  const loaded=await loadHeld();ok(!loaded.ok&&loaded.heldSales===known&&remoteWrites===0&&rendered===0,"Unreadable local holds preserve existing display and avoid overwrite");
  let syncSaved=0,syncApi=0;
  const syncContext={heldSalesSyncing:false,navigator:{onLine:true},selectedPosBranchId:"b",heldStorageLock:async(b,f)=>f(),heldStorageRows:async()=>{throw Error("decrypt")},offlineSave:async()=>syncSaved++,api:async()=>syncApi++,message:{},document:{querySelector:()=>({dataset:{}})},loadHeldSales:async()=>{},updateOfflineStatus:async()=>{}};
  const sync=new Function(...Object.keys(syncContext),patches.syncLocalHolds+";return syncLocalHolds;")(...Object.values(syncContext));
  await sync();ok(syncSaved===0&&syncApi===0,"Unreadable unsynced records are neither overwritten nor uploaded");
  return {checks,results};
}

runHeldTests(data.patches,data.helpers).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
