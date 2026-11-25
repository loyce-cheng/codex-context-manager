// Experimental, version-dependent evidence reader. Never sends IPC to the host.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp(`^/local/(${UUID})$`, 'i');
const PREFIX = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) info \[electron-message-handler\] IAB_LIFECYCLE received browser sidebar owner sync /;

export function parseOwnerSync(line) {
  const match = PREFIX.exec(line);
  if (!match || line.length > 16384) return null;
  const at = Date.parse(match[1]);
  if (!Number.isFinite(at)) return null;
  const fields = new Map();
  for (const m of line.slice(match[0].length).matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_]*)=("(?:\\.|[^"\\])*"|\S+)/g)) {
    if (!['ownerRoutePath', 'windowId', 'originWebContentsId'].includes(m[1])) continue;
    if (fields.has(m[1])) return null;
    let value = m[2];
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { return null; } }
    fields.set(m[1], value);
  }
  const windowId = Number(fields.get('windowId'));
  const rendererId = Number(fields.get('originWebContentsId'));
  if (!Number.isSafeInteger(windowId) || windowId <= 0 || !Number.isSafeInteger(rendererId) || rendererId <= 0) return null;
  const route = fields.get('ownerRoutePath');
  const signal = { at, windowId, rendererId, threadId: null, hostId: null, kind: 'unsupported-route' };
  if (typeof route !== 'string' || !route.startsWith('/local/')) return signal;
  let url; try { url = new URL(route, 'https://context-lens.invalid'); } catch { return signal; }
  const thread = ROUTE.exec(url.pathname);
  if (!thread || url.hash || url.searchParams.getAll('hostId').length !== 1 || url.searchParams.get('hostId') !== 'local') return signal;
  return { ...signal, kind: 'local-chat', hostId: 'local', threadId: thread[1].toLowerCase() };
}

export class SelectionGate {
  constructor({ windowId, rendererId, eligibleIds }) {
    this.windowId = windowId;
    this.rendererId = rendererId;
    this.eligible = new Set(eligibleIds);
    this.lastAt = -Infinity;
    this.value = { state: 'unknown', threadId: null };
  }
  accept(event) {
    if (!event || event.windowId !== this.windowId || event.rendererId !== this.rendererId || event.at < this.lastAt) return false;
    this.lastAt = event.at;
    const state = event.kind !== 'local-chat' ? 'unknown' : this.eligible.has(event.threadId) ? 'following' : 'out-of-scope';
    // Clear the old identity on leaving the allowed set, including historical chats.
    this.value = { state, threadId: state === 'following' ? event.threadId : null, eventAt: event.at };
    return true;
  }
}
