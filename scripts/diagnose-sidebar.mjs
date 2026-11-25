// Read-only startup diagnosis. Does not attach a debugger, inject scripts, or change settings.
import { readFile, readdir, open, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import http from 'node:http';
import { PROFILES } from '../native-sidebar/src/telemetry.mjs';
import { loaderClient,loaderInstallDirectory } from './sidebar-loader-client.mjs';

const run = promisify(execFile);
const includeWfp = process.argv.includes('--wfp');
const includeFirewall = process.argv.includes('--firewall') || includeWfp;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const data = join(process.env.LOCALAPPDATA ?? '', 'CodexScriptLoader');
const install = await loaderInstallDirectory(process.env.LOCALAPPDATA ?? '').catch(()=>null);
const readJson = async path => { try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')); } catch { return null; } };
const config = await readJson(join(data, 'config.json'));
const active = install ? await readJson(join(install, 'active.json')) : null;
const manifest = await readJson(join(data, 'scripts', 'local.context-lens.sidebar', 'manifest.json'));
const projectManifest = await readJson(join(root, 'native-sidebar', 'manifest.json'));

function tcpProbe(port) {
  return new Promise(resolveProbe => {
    let done = false;
    const start = Date.now(), socket = net.connect({ host: '127.0.0.1', port });
    const finish = status => {
      if (done) return;
      done = true; clearTimeout(timer); socket.destroy();
      resolveProbe({ status, elapsedMs: Date.now() - start });
    };
    const timer = setTimeout(() => finish('TIMEOUT'), 2000);
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', error => finish(error.code ?? 'ERROR'));
  });
}

async function controlProbe() {
  // Control and Codex are different server executables and may have different firewall rules.
  // A failed control weakens negative results; a successful Codex connection is direct evidence.
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  try {
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
    return await tcpProbe(server.address().port);
  } catch (error) { return { status: error.code ?? 'CONTROL_ERROR' }; }
  finally { for (const socket of sockets) socket.destroy(); await new Promise(ok => server.close(ok)); }
}

function getMetadata(port, path) {
  return new Promise(resolveMetadata => {
    let done = false, bytes = 0, chunks = [];
    const finish = result => { if (!done) { done = true; clearTimeout(timer); resolveMetadata(result); } };
    // Core http does not use proxy environment variables. Redirects are never followed.
    const request = http.get({ host: '127.0.0.1', port, path, agent: false }, response => {
      if (response.statusCode !== 200) { finish({ status: `HTTP_${response.statusCode}` }); response.destroy(); return; }
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 524288) { finish({ status: 'TOO_LARGE' }); request.destroy(); }
        else chunks.push(chunk);
      });
      response.on('error', error => finish({ status: error.code ?? 'RESPONSE_ERROR' }));
      response.on('end', () => {
        try { finish({ status: 'OK', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { finish({ status: 'INVALID_JSON' }); }
      });
    });
    const timer = setTimeout(() => { finish({ status: 'TIMEOUT' }); request.destroy(); }, 2500);
    request.on('error', error => finish({ status: error.code ?? 'REQUEST_ERROR' }));
  });
}

const report = {
  schemaVersion: 1, checkedAt: new Date().toISOString(), nativeCodexAcceptance: false,
  loader: { version: active?.version ?? null, running: null },
  extension: { version: manifest?.version ?? null, globalEnabled: config?.globalEnabled === true,
    safeMode: config?.safeMode ?? null, enabled: config?.scripts?.['local.context-lens.sidebar']?.enabled ?? null },
  processes: [], startup: null, loopbackControl: null, conclusions: install ? [] : ['LOADER_INSTALL_LOCATION_UNAVAILABLE'],
};

try {
  const script = `
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$items = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'")
$apps = @($items | Where-Object { $_.ExecutablePath -match 'WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\(?:ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object {
  $appVersion = if ($_.ExecutablePath -match 'OpenAI\\.Codex_([0-9.]+)_') { $Matches[1] } else { $null }
  $debugPort = if ($_.CommandLine -match '--remote-debugging-port=(\\d+)') { [int]$Matches[1] } else { $null }
  $listenerOwner = $null
  if ($debugPort) { $listenerOwner = @(Get-NetTCPConnection -LocalPort $debugPort -State Listen -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -ExpandProperty OwningProcess) }
  [pscustomobject]@{ pid=$_.ProcessId; appVersion=$appVersion; port=$debugPort; listenerOwned=($listenerOwner -contains $_.ProcessId) }
})
[pscustomobject]@{ loaderRunning=([bool](Get-Process -Name CodexScriptLoader -ErrorAction SilentlyContinue)); apps=$apps; execution=@{ elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); legacySandboxAccount=($identity.Name -match '\\\\CodexSandbox(?:Offline|Online)$') } } | ConvertTo-Json -Depth 4 -Compress
`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 65536 });
  const inventory = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  report.loader.running = inventory.loaderRunning;
  report.processes = inventory.apps ?? [];
  report.execution = inventory.execution;
} catch (error) { report.inventoryError = error.code ?? 'INVENTORY_FAILED'; }

try {
  const names = (await readdir(join(data, 'logs'))).filter(name => /^loader-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
  const latest = names.at(-1);
  if (latest) {
    const log = await open(join(data, 'logs', latest), 'r');
    let tail;
    try {
      const { size } = await log.stat(), start = Math.max(0, size - 65536);
      const buffer = Buffer.alloc(size - start);
      const { bytesRead } = await log.read(buffer, 0, buffer.length, start);
      tail = buffer.subarray(0, bytesRead).toString('utf8');
      if (start) tail = tail.slice(tail.indexOf('\n') + 1);
    } finally { await log.close(); }
    const lines = tail.trim().split(/\r?\n/).slice(-200);
    const events = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const latestState = events.filter(event => ['codex-activated', 'scripts-injected', 'startup-failed', 'managed-codex-exited'].includes(event.event)).at(-1);
    if (latestState) report.startup = { at: latestState.at, status: {
      'codex-activated': 'CODEX_ACTIVATED', 'scripts-injected': 'SCRIPTS_INJECTED', 'managed-codex-exited': 'CODEX_EXITED',
      'startup-failed': /CDP did not become ready/.test(latestState.detail?.message ?? '') ? 'CDP_DISCOVERY_TIMEOUT' : 'STARTUP_FAILED',
    }[latestState.event], historical: report.loader.running !== true };
  }
} catch { report.logReadStatus = 'UNAVAILABLE'; }

report.loopbackControl = await controlProbe();
for (const app of report.processes) {
  if (!Number.isInteger(app.port) || app.port < 1 || app.port > 65535 || !app.listenerOwned) continue;
  app.tcp = await tcpProbe(app.port);
  if (app.tcp.status !== 'CONNECTED') continue;
  const targets = await getMetadata(app.port, '/json');
  app.discovery = { status: targets.status };
  if (targets.status === 'OK' && Array.isArray(targets.value)) {
    const pages = targets.value.filter(target => target?.type === 'page');
    app.discovery.exactLoaderPages = pages.filter(target => target.url === 'app://-/index.html').length;
    app.discovery.nativePages = pages.filter(target => typeof target.url === 'string' && target.url.startsWith('app://-/')).length;
    app.discovery.pageCount = pages.length;
    // No titles, chat IDs, websocket URLs or browser history are written to the report.
  } else if (targets.status === 'OK') app.discovery.status = 'INVALID_TARGET_LIST';
}

if (report.loopbackControl.status !== 'CONNECTED') report.conclusions.push('CONTROL_LOOPBACK_FAILED_DOES_NOT_IMPLY_CODEX_FAILURE');
if (report.loader.running === false) report.conclusions.push('LOADER_NOT_RUNNING');
if (!report.extension.version) report.conclusions.push('EXTENSION_NOT_INSTALLED');
if (!report.extension.globalEnabled || report.extension.safeMode === true || report.extension.enabled === false) report.conclusions.push('EXTENSION_DISABLED_OR_CONFIG_UNAVAILABLE');
if (report.inventoryError) report.conclusions.push('PROCESS_INVENTORY_UNAVAILABLE');
else if (!report.processes.length) report.conclusions.push('NO_VERIFIED_CODEX_MAIN_PROCESS');
for (const app of report.processes) {
  if (report.extension.version === '0.1.0-alpha.1' && app.appVersion !== '26.1023.6123.0') report.conclusions.push('INSTALLED_ALPHA1_ADAPTER_DOES_NOT_MATCH_APP');
  if (report.extension.version === '0.1.0-alpha.2' && !['26.1023.6123.0','26.1103.3517.0'].includes(app.appVersion)) report.conclusions.push('INSTALLED_ALPHA2_ADAPTER_DOES_NOT_MATCH_APP');
  if (['0.1.0-alpha.3','0.1.0-alpha.4'].includes(report.extension.version) && !PROFILES.some(profile => profile.appVersion === app.appVersion)) report.conclusions.push('INSTALLED_ADAPTER_DOES_NOT_MATCH_APP');
  if (!app.port) report.conclusions.push('CODEX_STARTED_WITHOUT_DEBUG_PORT');
  else if (!app.listenerOwned) report.conclusions.push('DEBUG_LISTENER_NOT_VERIFIED');
  else if (report.loopbackControl.status === 'CONNECTED' && app.tcp.status !== 'CONNECTED') report.conclusions.push('CODEX_DEBUG_ENDPOINT_UNREACHABLE_FROM_THIS_PROCESS');
  else if (app.tcp.status !== 'CONNECTED') report.conclusions.push('CODEX_AND_CONTROL_FAILED_CAUSE_UNDETERMINED');
  if (app.discovery?.status === 'OK' && app.discovery.exactLoaderPages > 0) report.conclusions.push('VERIFIED_CODEX_DISCOVERY_REACHABLE');
  if (app.discovery?.status === 'OK' && app.discovery.exactLoaderPages === 0) report.conclusions.push('NO_PAGE_MATCHES_LOADER_061_FILTER');
}
if (report.loader.running && process.env.LOCALAPPDATA) {
  try {
    const response = await (await loaderClient(process.env.LOCALAPPDATA)).inspect();
    if (response.ok) {
      const value = response.result;
      report.renderer = { version: value.version, startup: value.startup ?? null, status: value.status,
        mode: value.mode, layoutOK: value.layoutOK, hasCurrentThread: !!value.threadId,
        capacity: value.capacity, percent: value.percent, diagnostics: value.diagnostics ?? null };
      if(report.renderer.diagnostics?.capacityPreflight){
        const {threadId,...preflight}=report.renderer.diagnostics.capacityPreflight;
        report.renderer.diagnostics.capacityPreflight={...preflight,hasCurrentThread:!!threadId,matchesMeterThread:!!threadId&&threadId===value.threadId};
      }
    } else report.renderer = { status: 'INSPECT_FAILED', code: response.error?.code ?? 'UNKNOWN' };
  } catch { report.renderer = { status: 'INSPECT_UNAVAILABLE' }; }
}
// A running locally verified adapter can support builds beyond the shipped list.
if (/^0\.1\.0-beta\.\d+$/.test(report.extension.version ?? '')) {
  for(const app of report.processes){
    const renderer=report.renderer;
    if(renderer?.version===report.extension.version && renderer.status==='unsupported'){
      report.conclusions.push('INSTALLED_ADAPTER_DOES_NOT_MATCH_APP');
      break;
    }
    const bundled=projectManifest?.version===report.extension.version && PROFILES.some(profile=>profile.appVersion===app.appVersion);
    if(!bundled && renderer?.diagnostics?.profile!==app.appVersion){
      report.conclusions.push('INSTALLED_ADAPTER_COMPATIBILITY_UNVERIFIED');
      break;
    }
  }
}
if (includeFirewall) {
  try {
    const script = `
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$admin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Action Block)
$details = @($rules | Select-Object -First 100 | ForEach-Object {
  $app = $_ | Get-NetFirewallApplicationFilter
  $ports = $_ | Get-NetFirewallPortFilter
  $addresses = $_ | Get-NetFirewallAddressFilter
  $security = $_ | Get-NetFirewallSecurityFilter
  $localUserScope = [string]$security.LocalUser
  [pscustomobject]@{ name=$_.Name; displayName=$_.DisplayName; direction=[string]$_.Direction; program=([IO.Path]::GetFileName($app.Program)); protocol=$ports.Protocol; localPort=$ports.LocalPort; remotePort=$ports.RemotePort; localAddress=$addresses.LocalAddress; remoteAddress=$addresses.RemoteAddress; hasLocalUserScope=([bool]$localUserScope -and $localUserScope -ne 'Any'); scopeMentionsCurrentUser=$localUserScope.Contains($identity.User.Value) }
})
[pscustomobject]@{ elevated=$admin; blockRuleCount=$rules.Count; truncated=($rules.Count -gt 100); profiles=@(Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction); rules=$details } | ConvertTo-Json -Depth 6 -Compress
`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 45000, maxBuffer: 524288 });
    report.firewall = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  } catch (error) { report.firewall = { status: 'QUERY_FAILED', code: error.code ?? 'UNKNOWN' }; }
}
report.conclusions = [...new Set(report.conclusions)];
report.interpretation = 'A block rule count alone does not prove applicability. Check user/security scope and process identity before attributing a connection failure.';
const directory = join(root, '.research');
await mkdir(directory, { recursive: true });
if (includeWfp) {
  report.wfp = [];
  for (const app of report.processes) {
    if (!app.listenerOwned || !Number.isInteger(app.port) || app.port < 1 || app.port > 65535) continue;
    const name = `wfp-loopback-${app.port}-${Date.now()}.xml`;
    try {
      const { stdout, stderr } = await run('netsh.exe', ['wfp', 'show', 'filters', `file=${join(directory, name)}`, 'protocol=6', 'localaddr=127.0.0.1', 'remoteaddr=127.0.0.1', `remoteport=${app.port}`, 'dir=OUT', 'verbose=ON'], { windowsHide: true, timeout: 45000, maxBuffer: 65536 });
      // netsh can print an elevation error even when its process exit code is zero.
      const body = await readFile(join(directory, name));
      report.wfp.push({ port: app.port, file: `.research/${name}`, bytes: body.length, status: body.length ? 'EXPORTED' : 'EMPTY' });
      const eventsName = `wfp-events-${app.port}-${Date.now()}.xml`;
      // Reads already-collected events only. Does not enable collection or start a capture.
      try {
        // Explicit timewindow was rejected locally (FWP_E_INVALID_INTERVAL). Keep
        // the endpoint filter and read the existing buffer using the default interval.
        await run('netsh.exe', ['wfp', 'show', 'netevents', `file=${join(directory, eventsName)}`, 'protocol=6', 'remoteaddr=127.0.0.1', `remoteport=${app.port}`], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
        report.wfp.push({ kind: 'existing-events', port: app.port, file: `.research/${eventsName}`, bytes: (await readFile(join(directory, eventsName))).length, status: 'EXPORTED' });
      } catch (error) { report.wfp.push({ kind: 'existing-events', port: app.port, status: 'UNAVAILABLE', code: error.code ?? 'UNKNOWN' }); }
    } catch (error) { report.wfp.push({ port: app.port, status: 'EXPORT_FAILED', code: error.code ?? 'UNKNOWN' }); }
  }
  const stateName = `wfp-state-${Date.now()}.xml`;
  try {
    await run('netsh.exe', ['wfp', 'show', 'state', `file=${join(directory, stateName)}`], { windowsHide: true, timeout: 45000, maxBuffer: 65536 });
    report.wfp.push({ kind: 'registered-callout-state', file: `.research/${stateName}`, bytes: (await readFile(join(directory, stateName))).length, status: 'EXPORTED' });
  } catch (error) { report.wfp.push({ kind: 'registered-callout-state', status: 'UNAVAILABLE', code: error.code ?? 'UNKNOWN' }); }
}
const output = join(directory, includeWfp ? 'sidebar-wfp-diagnostic.json' : includeFirewall ? 'sidebar-network-diagnostic.json' : 'sidebar-diagnostic.json');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(`\nSaved: ${output}`);
