import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../live-worker/index.js',import.meta.url),'utf8');
test('products filter by brand while services retain sub-category and stale filters reset',()=>{
 const select=()=>({value:'',dataset:{},setAttribute(k,v){this[k]=v;}});
 const category=select(),detail=select(),input={value:'',setAttribute(){}},options={querySelectorAll:()=>[]};
 const row={dataset:{itemType:'product'},querySelectorAll:()=>[],querySelector(selector){return selector.includes('saleItemSearch')?input:selector.includes('saleItemCategory')?category:selector.includes('saleItemSubCategory')?detail:selector==='.sale-picker-options'?options:{classList:{remove(){}},setAttribute(){}};}};
 const catalog=[{type:'product',id:'p1',name:'Shampoo A',category:'Hair',brand:'Alpha',subCategory:'Care',priceCents:2000},{type:'product',id:'p2',name:'Shampoo B',category:'Hair',brand:'Beta',subCategory:'Care',priceCents:3000},{type:'service',id:'s1',name:'Haircut',category:'Hair',subCategory:'Cuts',priceCents:4000}];
 const context={document:{querySelectorAll:()=>[]},findSaleItem:()=>null,saleCatalog:()=>catalog,esc:String,money:String};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function renderSaleItemPicker('),source.indexOf('function availableBookingServices(')),context);
 context.renderSaleItemPicker(row,true);assert.match(detail.innerHTML,/All brands/);assert.equal(detail['aria-label'],'Brand');
 detail.value='Alpha';context.renderSaleItemPicker(row,true);assert.match(options.innerHTML,/Shampoo A/);assert.doesNotMatch(options.innerHTML,/Shampoo B/);
 row.dataset.itemType='service';context.renderSaleItemPicker(row,true);assert.equal(detail.value,'');assert.match(detail.innerHTML,/All sub-categories/);assert.match(options.innerHTML,/Haircut/);
});
