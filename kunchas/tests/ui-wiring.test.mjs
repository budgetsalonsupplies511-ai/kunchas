import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../live-worker/index.js', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n')
  .replace(/from "(\.\/[^"]+)"/g, (_, path) => 'from ' + JSON.stringify(new URL('../live-worker/' + path, import.meta.url).href))
  .replace('  searchCustomers\n};', '  searchCustomers, renderApp\n};');
const { renderApp } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

for (const [role, mode] of [['owner','admin'], ['admin','admin'], ['manager','admin'], ['branch','staff']]) {
  test(role + ' page wires every required static click/change/submit target', () => {
    const user = { id:role, name:role, role, staffId:role === 'branch' ? null : 'staff-1', permissions:{}, allBranches:role === 'owner', branchIds:['branch-1'] };
    const html = renderApp('', mode === 'admin' ? 'overview' : 'pos', mode, user);
    const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
    const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    const tabTargets = [...markup.matchAll(/\bdata-(?:team-)?tab="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(tabTargets.filter(id => !ids.has(id)), [], 'navigation points to a missing section');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    const buttonIds = [...markup.matchAll(/<button\b[^>]*>/g)]
      .map(match => /\btype="button"/.test(match[0]) ? match[0].match(/\bid="([^"]+)"/)?.[1] : null).filter(Boolean);
    assert.deepEqual(buttonIds.filter(id => !scripts.some(script => script.includes(id))), [], 'button has no client reference');
    for (const script of scripts) {
      new vm.Script(script);
      for (const match of script.matchAll(/\.id\s*=\s*(['"])([A-Za-z][A-Za-z0-9_-]*)\1/g)) ids.add(match[2]);
      const requiredTargets = [...script.matchAll(/document\.querySelector\((["'])#([A-Za-z][A-Za-z0-9_-]*)\1\)\.addEventListener/g)].map(match => match[2]);
      const missing = requiredTargets.filter(id => !ids.has(id));
      assert.deepEqual(missing, [], 'missing event targets: ' + missing.join(', '));
    }
  });
}
