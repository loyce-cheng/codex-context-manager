import { NativeSource } from './telemetry.mjs';
import { createSidebar } from './view.mjs';
import sidebarManifest from '../manifest.json' with { type: 'json' };

let instance = null;
let epoch = 0;
let startup = 'stopped';
export async function start(api) {
  stop();
  const ownEpoch = epoch;
  startup = 'waiting-dom';
  try {
    await api.dom.ready();
    if (ownEpoch !== epoch) return;
    instance = createSidebar(new NativeSource());
    startup = 'started';
  } catch {
    if (ownEpoch === epoch) startup = 'failed';
  }
  return stop;
}
export function stop() { epoch++; instance?.stop(); instance = null; startup = 'stopped'; }
export function invokeHostCommand(operation, payload = {}) {
  if(operation==='measured' && payload && Object.keys(payload).length===2 && /^[0-9a-f]{32}$/.test(payload.id) &&
      Number.isSafeInteger(payload.capacity) && payload.capacity>0)
    return {displayed:instance?.confirmTurn(payload.id,payload.capacity)??false};
  if(operation==='staged' && payload && Object.keys(payload).length===1 && /^[0-9a-f]{32}$/.test(payload.id))
    return {displayed:instance?.acknowledgeChoice(payload.id)??false};
  if (operation !== 'inspect' || !payload || Array.isArray(payload) || typeof payload !== 'object' || Object.keys(payload).length) throw new Error('Only inspect with an empty object is supported.');
  return { version: sidebarManifest.version, startup, ...(instance?.status() ?? { status: 'stopped', layoutOK: false }) };
}
