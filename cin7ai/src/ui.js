export const dashboard = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cin7AI · Omni workspace</title>
  <style>
    :root{color-scheme:dark;--ink:#f3f7f6;--muted:#9caeaa;--line:#29423c;--panel:#11251f;--accent:#61e8b6;--warn:#ffc46b}
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at 85% 0,#183d33 0,transparent 38%),#07120f;color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
    header,main{width:min(1120px,calc(100% - 32px));margin:auto} header{padding:46px 0 28px;display:flex;justify-content:space-between;align-items:end;gap:20px}
    .eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase} h1{font-size:clamp(38px,7vw,72px);line-height:.95;letter-spacing:-.06em;margin:8px 0 0} .lead{max-width:450px;color:var(--muted);margin:0}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}.card{background:linear-gradient(145deg,rgba(22,48,40,.94),rgba(11,27,22,.96));border:1px solid var(--line);border-radius:20px;padding:24px;box-shadow:0 24px 60px #0005}
    h2{margin:0 0 4px;font-size:18px}.muted{color:var(--muted)}.status{display:flex;align-items:center;gap:10px;margin:22px 0}.dot{width:10px;height:10px;border-radius:50%;background:var(--warn);box-shadow:0 0 18px currentColor}.dot.ok{background:var(--accent)}
    label{display:block;color:var(--muted);font-size:12px;margin:16px 0 6px}input,select,button{width:100%;border:1px solid var(--line);border-radius:11px;padding:11px 13px;background:#091a15;color:var(--ink);font:inherit}button{cursor:pointer;background:var(--accent);border:0;color:#042017;font-weight:800;margin-top:16px}button.secondary{background:#173a30;color:var(--ink)}
    pre{height:340px;overflow:auto;white-space:pre-wrap;background:#06100d;border:1px solid #1d352f;border-radius:12px;padding:16px;color:#bfe4d7;font:12px/1.55 ui-monospace,monospace}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}footer{padding:24px 0 48px;color:var(--muted);font-size:12px}
    @media(max-width:760px){header{align-items:start;flex-direction:column}.grid{grid-template-columns:1fr}.row{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header><div><div class="eyebrow">Independent cloud project</div><h1>Cin7<span style="color:var(--accent)">AI</span></h1></div><p class="lead">A secure, read-only workspace for exploring your Cin7 Omni data. Credentials stay inside the Cloudflare Worker.</p></header>
  <main class="grid">
    <section class="card">
      <h2>Omni connection</h2><div class="muted">Validate the Worker secrets against Cin7.</div>
      <div class="status"><span id="dot" class="dot"></span><strong id="status">Not checked</strong></div>
      <label for="token">Workspace token</label><input id="token" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
      <button id="check">Check connection</button>
      <p class="muted" style="font-size:12px">The workspace token is held only in this browser tab.</p>
    </section>
    <section class="card">
      <h2>Data explorer</h2><div class="muted">Send a read-only request to an approved Omni resource.</div>
      <div class="row"><div><label for="resource">Resource</label><select id="resource"><option value="products">Products</option><option value="stock">Stock</option><option value="sales">Sales orders</option><option value="purchases">Purchase orders</option><option value="contacts">Contacts</option><option value="branches">Branches</option></select></div><div><label for="rows">Rows</label><input id="rows" type="number" value="10" min="1" max="250"></div></div>
      <button id="load" class="secondary">Load data</button>
    </section>
    <section class="card" style="grid-column:1/-1"><h2>Response</h2><pre id="output">Ready.</pre></section>
  </main><footer>Read-only by design · Cin7AI is separate from Kunchas</footer>
  <script>
    const token = document.querySelector('#token'), output = document.querySelector('#output');
    async function call(path){output.textContent='Loading…';try{const r=await fetch(path,{headers:{authorization:'Bearer '+token.value}});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');output.textContent=JSON.stringify(data,null,2);return true}catch(e){output.textContent=e.message;return false}}
    document.querySelector('#check').onclick=async()=>{const ok=await call('/api/status');document.querySelector('#dot').className='dot'+(ok?' ok':'');document.querySelector('#status').textContent=ok?'Connected':'Connection failed'};
    document.querySelector('#load').onclick=()=>call('/api/cin7/'+document.querySelector('#resource').value+'?rows='+encodeURIComponent(document.querySelector('#rows').value));
  </script>
</body></html>`;
