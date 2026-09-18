import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('staff search and status filters preserve a draft add-staff form',()=>{
 const elements={'#staffSearch':{value:'ava'},'#staffStatusFilter':{value:'Active'},'#staffTable':{},'#staffCount':{},'#staffForm':{hidden:false},'#staffForm [data-day-off-checks]':{innerHTML:'draft'}};
 const context={state:{staff:[{id:'a',name:'Ava Singh',status:'Active'},{id:'b',name:'Ava Other',status:'Inactive'}]},document:{querySelector:s=>elements[s],querySelectorAll:()=>[]},esc:String,roleName:()=>'',dayOffLabel:()=>'',money:String,staffSalesTotal:()=>0,dayOffChecksHtml:()=>'<input>',openStaffProfile:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function renderStaff()'),source.indexOf('function staffSaleRows(')),context);
 context.renderStaff();
 assert.match(elements['#staffTable'].innerHTML,/Ava Singh/);assert.doesNotMatch(elements['#staffTable'].innerHTML,/Ava Other/);
 assert.equal(elements['#staffForm [data-day-off-checks]'].innerHTML,'draft');
 elements['#staffSearch'].value='missing';context.renderStaff();assert.match(elements['#staffTable'].innerHTML,/No staff match/);
});
