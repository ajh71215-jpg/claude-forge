// Comprehensive CDP regression for every EXTEND panel: drive the real UI,
// then confirm on-disk effects. Cleans up all test artifacts at the end.
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const WS = join(process.env.APPDATA, 'claude-forge', 'workspace')
const PLUGIN_DIR = join(process.env.TEMP, 'forge-test-plugin')

// Make a throwaway local plugin (dir + manifest) for the plugins test.
try {
  mkdirSync(join(PLUGIN_DIR, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'forge-test-plugin', version: '0.0.0' }, null, 2)
  )
} catch (e) {
  console.log('plugin scaffold error', String(e))
}

const base = 'http://127.0.0.1:9222'
const page = (await (await fetch(`${base}/json`)).json()).find(
  (t) => t.type === 'page' && t.webSocketDebuggerUrl
)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
}
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable')
async function ev(body) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.result?.exceptionDetails) return { __err: JSON.stringify(r.result.exceptionDetails).slice(0, 300) }
  return r.result?.result?.value
}
const J = (v) => JSON.stringify(v)

const H = `
  const btn=(sel,t)=>[...document.querySelectorAll(sel)].find(b=>(b.textContent||'').includes(t));
  const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,ms=3500)=>{const t0=Date.now();while(Date.now()-t0<ms){const v=fn();if(v)return v;await wait(80)}return null};
  const setI=(el,v)=>{const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
  const setS=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('change',{bubbles:true}))};
  const nav=(t)=>{const n=[...document.querySelectorAll('.extend-nav-item')].find(e=>e.textContent.includes(t));if(n)n.click();return !!n};
`
const out = {}

// Open EXTEND, confirm all 6 sections present and ready (no "soon").
out.nav = await ev(`${H}
  btn('.mode-tab','EXTEND')?.click(); await wait(200);
  return { items:[...document.querySelectorAll('.extend-nav-item')].map(e=>e.textContent),
           soon: document.querySelectorAll('.extend-soon').length };
`)

// ---------- Commands ----------
await ev(`return await window.forge.commands.delete('forge-test-cmd');`)
out.commands = await ev(`${H}
  nav('Commands'); await wait(150);
  btn('.skills-new','New command').click(); await wait(150);
  const ins=[...document.querySelectorAll('.skill-editor input.skill-input')];
  const body=document.querySelector('.skill-editor .skill-body');
  setI(ins[0],'forge-test-cmd'); setI(ins[1],'A throwaway test command.'); setI(ins[2],'[arg]');
  setI(body,'Echo: $ARGUMENTS'); await wait(80);
  btn('.skill-editor .modal-actions .primary','Save').click();
  const row=await until(()=>[...document.querySelectorAll('.skill-name')].find(e=>e.textContent.includes('/forge-test-cmd')));
  return { rowText: row?.textContent };
`)
out.commandsDetail = await ev(`return await window.forge.commands.read('forge-test-cmd');`)
try { out.commandsFile = readFileSync(out.commandsDetail.path, 'utf8') } catch (e) { out.commandsFile = String(e) }
out.commandsCleanup = await ev(`return (await window.forge.commands.delete('forge-test-cmd')).map(c=>c.name);`)

// ---------- Hooks ----------
out.hooks = await ev(`${H}
  nav('Hooks'); await wait(150);
  btn('.hooks-head-actions .skill-act','Add hook').click(); await wait(120);
  const row=document.querySelector('.hook-row');
  setS(row.querySelector('.hook-select'),'Stop');
  setI(row.querySelector('.hook-cmd'),'echo forge-test-hook');
  await wait(80);
  btn('.skills-new','Save').click(); await wait(500);
  return await window.forge.hooks.list();
`)
try { out.hooksFile = JSON.parse(readFileSync(join(WS, '.claude', 'settings.json'), 'utf8')) } catch (e) { out.hooksFile = String(e) }
out.hooksCleanup = await ev(`return await window.forge.hooks.save([]);`)

// ---------- MCP ----------
await ev(`return await window.forge.mcp.delete('forge-test-mcp');`)
out.mcp = await ev(`${H}
  nav('MCP'); await wait(150);
  btn('.skills-new','Add server').click(); await wait(150);
  const ins=[...document.querySelectorAll('.skill-editor input.skill-input')];
  const bodies=[...document.querySelectorAll('.skill-editor .skill-body')];
  setI(ins[0],'forge-test-mcp'); setI(ins[1],'node'); setI(bodies[0],'--version');
  await wait(80);
  btn('.skill-editor .modal-actions .primary','Save').click();
  const row=await until(()=>[...document.querySelectorAll('.skill-name')].find(e=>e.textContent.includes('forge-test-mcp')));
  return { rowText: row?.textContent };
`)
out.mcpList = await ev(`return (await window.forge.mcp.list()).map(s=>({name:s.name,transport:s.transport,command:s.command,args:s.args}));`)
try { out.mcpFile = JSON.parse(readFileSync(join(WS, 'forge-mcp.json'), 'utf8')) } catch (e) { out.mcpFile = String(e) }
out.mcpCleanup = await ev(`return (await window.forge.mcp.delete('forge-test-mcp')).map(s=>s.name);`)

// ---------- Agents ----------
await ev(`return await window.forge.agents.delete('forge-test-agent');`)
out.agents = await ev(`${H}
  nav('Agents'); await wait(150);
  btn('.skills-new','New agent').click(); await wait(150);
  const ins=[...document.querySelectorAll('.skill-editor input.skill-input')];
  const body=document.querySelector('.skill-editor .skill-body');
  setI(ins[0],'forge-test-agent'); setI(ins[1],'A throwaway test agent.');
  setI(ins[2],'Read, Grep'); setI(ins[3],'sonnet'); setI(body,'You are a test agent.');
  await wait(80);
  btn('.skill-editor .modal-actions .primary','Save').click();
  const row=await until(()=>[...document.querySelectorAll('.skill-name')].find(e=>e.textContent.includes('forge-test-agent')));
  return { rowText: row?.textContent };
`)
out.agentsDetail = await ev(`return await window.forge.agents.read('forge-test-agent');`)
try { out.agentsFile = readFileSync(out.agentsDetail.path, 'utf8') } catch (e) { out.agentsFile = String(e) }
out.agentsCleanup = await ev(`return (await window.forge.agents.delete('forge-test-agent')).map(a=>a.name);`)

// ---------- Plugins ----------
await ev(`return await window.forge.plugins.remove(${J(PLUGIN_DIR)});`)
out.pluginsBadPath = await ev(`${H}
  nav('Plugins'); await wait(150);
  const inp=document.querySelector('.plugin-add .skill-input');
  setI(inp, 'C:/no/such/forge/path'); await wait(60);
  btn('.plugin-add .skills-new','Add').click(); await wait(400);
  return { error: document.querySelector('.skill-error')?.textContent };
`)
out.pluginsGood = await ev(`${H}
  const inp=document.querySelector('.plugin-add .skill-input');
  setI(inp, ${J(PLUGIN_DIR)}); await wait(60);
  btn('.plugin-add .skills-new','Add').click();
  const row=await until(()=>[...document.querySelectorAll('.skill-row .skill-name')].find(e=>e.textContent.includes('forge-test-plugin')));
  return { rowText: row?.textContent };
`)
out.pluginsList = await ev(`return (await window.forge.plugins.list()).map(p=>({path:p.path,enabled:p.enabled,exists:p.exists,name:p.manifestName}));`)
out.pluginsCleanup = await ev(`return (await window.forge.plugins.remove(${J(PLUGIN_DIR)})).length;`)

// ---------- Skills regression + CHAT regression ----------
out.skillsPanel = await ev(`${H} nav('Skills'); await wait(150); return { present: !!document.querySelector('.skills-panel'), title: document.querySelector('.skills-title')?.textContent };`)
out.chatRegression = await ev(`${H} btn('.mode-tab','CHAT')?.click(); await wait(150); return { composer: !!document.querySelector('.composer-wrap, .composer, textarea') };`)

console.log(JSON.stringify(out, null, 2))
ws.close()
try { rmSync(PLUGIN_DIR, { recursive: true, force: true }) } catch {}
