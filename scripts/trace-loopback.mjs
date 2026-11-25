// User-authorized, short WFP event trace. No packet payload requests, login or model calls.
// Never starts over an existing capture, never edits firewall/proxy policy.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const run = promisify(execFile), self = fileURLToPath(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
function nativeText(value) {
  if (!Buffer.isBuffer(value)) return String(value ?? '');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { return new TextDecoder('gb18030').decode(value); }
}
async function netsh(args, timeout = 10000) {
  try {
    const result = await run('netsh.exe', args, { windowsHide: true, timeout, maxBuffer: 65536, encoding: 'buffer' });
    return { code: 0, text: `${nativeText(result.stdout)}${nativeText(result.stderr)}`.trim() };
  } catch (error) { return { code: error.code ?? 'FAILED', text: `${nativeText(error.stdout)}${nativeText(error.stderr)}`.trim(), killed: Boolean(error.killed) }; }
}
function noCapture(result) {
  return result.code === 0 && /^(?:No capture is in progress\.|(?:当前)?(?:没有正在进行的捕获|没有正在进行捕获|未在进行捕获|未进行捕获|没有捕获正在进行)[。.]?)$/iu.test(result.text.trim());
}
function ownsStatus(status, tracePath) {
  return status.code === 0 && status.text.toLowerCase().includes(basename(tracePath).toLowerCase());
}

// Independent cleanup after a parent failure; only stops a session whose status names our file.
if (process.argv[2] === '--watchdog') {
  const directory = resolve(process.argv[3] ?? '');
  if (!directory.startsWith(join(root, '.research', 'wfp-trace-'))) process.exit(2);
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    let receipt;
    try { receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8')); } catch { continue; }
    if (receipt.finished) process.exit(0);
    if (!receipt.owned || Date.now() - receipt.startedAt < 18000) continue;
    const status = await netsh(['wfp', 'capture', 'status']);
    const stop = ownsStatus(status, receipt.tracePath) ? await netsh(['wfp', 'capture', 'stop'], 15000) : { code: 'OWNERSHIP_NOT_CONFIRMED' };
    await writeFile(join(directory, 'watchdog.json'), JSON.stringify({ status, stop }, null, 2));
    process.exit(stop.code === 0 ? 0 : 1);
  }
  process.exit(0);
}

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Pass the verified Codex debug port.');
const directory = join(root, '.research', `wfp-trace-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(directory, { recursive: false });
const tracePath = join(directory, `context-lens-${basename(directory)}.etl`);
const report = { checkedAt: new Date().toISOString(), diagnosticPort: port, pid: process.pid, directory, tracePath, probes: [], completed: false };
let owned = false, receipt = { owned: false, finished: false, tracePath }, server;
const sockets = new Set();
const saveReceipt = () => writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt));
function probe(label, targetPort) {
  return new Promise(ok => {
    const startedAt = new Date().toISOString(), started = Date.now();
    const socket = net.connect({ host: '127.0.0.1', port: targetPort });
    let done = false;
    const finish = status => { if (done) return; done = true; clearTimeout(timer); const localPort = socket.localPort ?? null; socket.destroy(); ok({ label, targetPort, localPort, startedAt, elapsedMs: Date.now() - started, status }); };
    const timer = setTimeout(() => finish('TIMEOUT'), 1800);
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', error => finish(error.code ?? 'ERROR'));
  });
}
try {
  // Verify elevation and main-process listener without retaining full command lines.
  const inventoryCode = `
$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$principal=[Security.Principal.WindowsPrincipal]::new($identity)
$listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Where-Object LocalAddress -eq '127.0.0.1')
$apps=@($listeners | ForEach-Object { Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_.OwningProcess) } | Where-Object { $_.ExecutablePath -match 'WindowsApps\\\\OpenAI\\.Codex_[^\\\\]+\\\\app\\\\(?:ChatGPT|Codex)\\.exe$' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -match '--remote-debugging-port=${port}(?:\\s|$)' })
[pscustomobject]@{ elevated=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); verified=($apps.Count -eq 1) } | ConvertTo-Json -Compress
`;
  const inventory = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', inventoryCode], { windowsHide: true, timeout: 15000, maxBuffer: 8192 });
  report.inventory = JSON.parse(inventory.stdout.replace(/^\uFEFF/, ''));
  if (!report.inventory.elevated || !report.inventory.verified) throw Error('Elevation or Codex listener not verified.');
  report.beforeStatus = await netsh(['wfp', 'capture', 'status']);
  if (!noCapture(report.beforeStatus)) throw Error('Existing capture or unknown status; nothing started.');
  report.beforeOptions = { events: await netsh(['wfp', 'show', 'options', 'optionsfor=NETEVENTS']), keywords: await netsh(['wfp', 'show', 'options', 'optionsfor=KEYWORDS']) };
  server = net.createServer(socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  report.controlPort = server.address().port;
  await saveReceipt();
  const watchdog = spawn(process.execPath, [self, '--watchdog', directory], { windowsHide: true, detached: true, stdio: 'ignore' });
  await new Promise((ok, fail) => { watchdog.once('spawn', ok); watchdog.once('error', fail); });
  watchdog.unref();
  report.start = await netsh(['wfp', 'capture', 'start', 'cab=OFF', 'traceonly=ON', 'keywords=NONE', `file=${tracePath}`]);
  report.activeStatus = await netsh(['wfp', 'capture', 'status']);
  const traceCreated = await stat(tracePath).then(info => info.isFile(), () => false);
  // A unique file/path receipt proves this session belongs to this invocation.
  owned = ownsStatus(report.activeStatus, tracePath) || ownsStatus(report.start, tracePath) || (report.start.code === 0 && traceCreated);
  if (!owned) throw Error('Capture ownership was not confirmed; inspect start/status before taking further action.');
  receipt = { ...receipt, owned: true, startedAt: Date.now() }; await saveReceipt();
  if (report.start.code !== 0 || noCapture(report.activeStatus)) throw Error('Capture was not active after startup; cleaning up.');
  for (let i = 0; i < 2; i++) {
    report.probes.push(await probe('temporary-loopback-control', report.controlPort));
    report.probes.push(await probe('codex-debug', port));
    if (i === 0) await sleep(500);
  }
  await sleep(500);
  report.completed = true;
} catch (error) { report.error = String(error.message ?? error).slice(0,1200); }
finally {
  for (const socket of sockets) socket.destroy();
  if (server?.listening) await new Promise(ok => server.close(ok));
  if (owned) {
    report.stop = await netsh(['wfp', 'capture', 'stop'], 15000);
    report.afterStatus = await netsh(['wfp', 'capture', 'status']);
    report.captureStopped = noCapture(report.afterStatus);
    report.afterOptions = { events: await netsh(['wfp', 'show', 'options', 'optionsfor=NETEVENTS']), keywords: await netsh(['wfp', 'show', 'options', 'optionsfor=KEYWORDS']) };
    report.optionsUnchanged = JSON.stringify(report.beforeOptions) === JSON.stringify(report.afterOptions);
  }
  receipt.finished = !owned || report.captureStopped === true; await saveReceipt();
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(root, '.research', 'loopback-trace-latest.json'), JSON.stringify({ directory, completed: report.completed, captureStopped: report.captureStopped ?? null, error: report.error ?? null }, null, 2) + '\n');
}
console.log(JSON.stringify({ directory, completed: report.completed, captureStopped: report.captureStopped, optionsUnchanged: report.optionsUnchanged, error: report.error }));
if (!report.completed || !report.captureStopped) process.exitCode = 1;
