import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { accessClientScript } from '../src/access-ui.mjs';

const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('staff screens and client code contain no pay rate fields or pay estimates', () => {
  const ui = source.slice(source.indexOf('function renderApp('));
  assert.doesNotMatch(ui, /hourlyRate|hourly_rate|grossPay|payCents|totalPay|Hourly rate|Estimated pay|Gross pay/);
  assert.match(ui, /<th>Total hours<\/th>/);
  assert.doesNotMatch(accessClientScript(), /payHeader|row\.children\[3\]/);
});

test('payroll Excel export keeps hours and status without pay columns', () => {
  const statement = source.split('\n').find(line => line.includes('if (type === "payroll") return'));
  const context = { type: 'payroll', report: { payrollRows: [{date:'2026-09-17',staff:'Test',role:'Stylist',branch:'City',clockIn:'09:00',breakMinutes:30,clockOut:'17:00',hours:7.5,hourlyRateCents:4000,grossPayCents:30000,status:'Complete'}] }, excelReportResponse: (title, headers, rows) => ({title,headers,rows}) };
  const result = vm.runInNewContext('(function(){' + statement + '})()', context);
  assert.equal(result.headers.length, 9);
  assert.equal(result.rows[0].length, 9);
  assert.equal(result.rows[0][7], 7.5);
  assert.equal(result.rows[0][8], 'Complete');
  assert.doesNotMatch(result.headers.join(' '), /Rate|Pay$/);
});

test('editing staff without a rate retains their saved payroll data', () => {
  assert.match(source, /body\.hourlyRate === undefined \? existing\.hourly_rate_cents/);
});
