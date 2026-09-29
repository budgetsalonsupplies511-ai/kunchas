import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../live-worker/index.js',import.meta.url),'utf8');
test('imported member without a login account opens the staff editor',()=>{
 const elements=Object.fromEntries(['staffId','name','role','accessRole','email','phone','xeroEmployeeId','xeroEarningsRateId','status','username','pin','enabled','allBranches'].map(k=>[k,{value:''}]));
 const children={};const form={id:'staffProfileForm',elements,querySelector(s){return children[s]??={};}};
 let opened=false;const nodes={'#staffProfileForm':form,'#staffProfile':{open:false,showModal(){opened=true;}}};
 const c={state:{staff:[{id:'imported',name:'Imported Member',status:'Active'}]},accessSettingsData:{users:[{staffId:'imported',role:'none',branchIds:null}],branches:[{id:'branch-a',name:'Ashfield'}]},canManageAccess:()=>true,document:{querySelector(s){return nodes[s]??={};}},dayOffChecksHtml:()=>'',staffSaleRows:()=>[],staffSalesTotal:()=>0,money:String,renderStaffHours:()=>{},esc:String};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function renderStaffLogin('),source.indexOf('function staffLoginValues(')),c);
 vm.runInContext(source.slice(source.indexOf('function openStaffProfile('),source.indexOf('async function submitStaffForm(')),c);
 c.openStaffProfile('imported');
 assert.equal(opened,true);assert.equal(elements.name.value,'Imported Member');assert.equal(elements.accessRole.value,'none');
 assert.doesNotMatch(children['[data-branch-checks]'].innerHTML,/ checked/);
});
