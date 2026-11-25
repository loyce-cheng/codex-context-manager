import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { normalizeSnapshot, validTokens } from '../core/context.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLLOUT = /^rollout-(\d{4}-\d{2}-\d{2})T.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
export function assertThreadId(id) { if (typeof id !== 'string' || !UUID.test(id)) throw new Error('需要有效的 Codex 会话 ID。'); return id.toLowerCase(); }
export function within(root, path) { const part = relative(root, path); return !part.startsWith('..') && !isAbsolute(part); }

/** Whitelist scalar telemetry. Text, tool payloads, credentials and account rate limits are discarded. */
export function extractTelemetry(lines, seed = {}) {
  const result = { ...seed };
  for (const line of lines) {
    if (!line || line.length > 1024 * 1024) continue;
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const p = record.payload;
    if (record.type === 'session_meta' && UUID.test(p?.id ?? '')) result.sessionId = p.id;
    if (record.type === 'turn_context' && typeof p?.model === 'string') result.model = p.model.slice(0, 100);
    if (record.type !== 'event_msg' || !p) continue;
    if (p.type === 'task_started') result.state = 'running';
    if (p.type === 'task_complete' || p.type === 'turn_aborted') result.state = 'idle';
    if (p.type === 'context_compacted' || p.type === 'context_compaction') {
      result.compactionEpoch = record.timestamp;
      result.used = null; result.measuredAt = null;
    }
    if (p.type === 'token_count' && p.info) {
      const used = p.info.last_token_usage?.total_tokens;
      // total_token_usage is cumulative historical usage, not active context occupancy.
      result.used = validTokens(used) ? used : null;
      result.window = p.info.model_context_window;
      result.measuredAt = record.timestamp;
    }
  }
  return result;
}

export class LocalCodexSource {
  constructor({ home = process.env.CODEX_HOME || join(homedir(), '.codex'), maxTailBytes = 2 * 1024 * 1024 } = {}) {
    this.home = resolve(home); this.maxTailBytes = maxTailBytes; this.index = new Map(); this.indexAt = 0;
    this.snapshots = new Map(); this.modelCacheAt = 0; this.models = new Map(); this.refreshing = null;
  }
  capabilities() {
    return {
      localSnapshots: true, usageSource: 'persisted-token-count', nativeStatusParity: false,
      activeThreadBinding: false, bindingMode: 'explicit-thread', runtimeWindowUpdate: false,
      nativeSidebarSlot: false, freeFloatingWindow: false, hostSafeGeometry: false,
      reason: '已实现本地只读快照；原生选中会话通知、布局插槽与会话热扩容尚未验证。',
    };
  }
  async refreshIndex(force = false) {
    if (!force && Date.now() - this.indexAt < 30000) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const index = new Map(); let visited = 0;
      const walk = async (dir, root, depth) => {
        if (depth > 4 || ++visited > 4000) return;
        let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
        entries.sort((a,b)=>b.name.localeCompare(a.name));
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const path = join(dir, entry.name);
          if (entry.isDirectory() && /^\d{2,4}$/.test(entry.name)) await walk(path, root, depth + 1);
          else if (entry.isFile()) {
            const match = ROLLOUT.exec(entry.name);
            if (match) {
              const threadId=match[2].toLowerCase();
              if(!index.has(threadId))index.set(threadId,{path,root,date:match[1],threadId});
            }
          }
        }
      };
      const root = join(this.home, 'sessions'); await walk(root, root, 0);
      this.index = index; this.indexAt = Date.now();
    })();
    try { await this.refreshing; } finally { this.refreshing = null; }
  }
  async listThreads() {
    await this.refreshIndex();
    return [...this.index.values()].sort((a, b) => b.path.localeCompare(a.path)).slice(0, 60)
      .map(({ threadId, date }) => ({ threadId, date, label: `${date} · ${threadId.slice(0, 8)}` }));
  }
  async modelCatalog() {
    if (Date.now() - this.modelCacheAt < 30000) return this.models;
    const models = new Map();
    for (const file of ['models_cache.json', 'models_cache.codex_work_desktop.json']) {
      try {
        const path = join(this.home, file); if ((await stat(path)).size > 8 * 1024 * 1024) continue;
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        for (const m of Array.isArray(parsed?.models) ? parsed.models : []) {
          if (!m || typeof m.slug !== 'string') continue;
          models.set(m.slug, { defaultWindow: m.context_window, maxWindow: m.max_context_window, effectivePercent: m.effective_context_window_percent });
        }
      } catch (e) { if (!['ENOENT', 'EACCES'].includes(e.code) && !(e instanceof SyntaxError)) throw e; }
    }
    this.models = models; this.modelCacheAt = Date.now(); return models;
  }
  async rolloutPath(threadId) {
    threadId = assertThreadId(threadId); await this.refreshIndex();
    if (!this.index.has(threadId)) await this.refreshIndex(true);
    const item = this.index.get(threadId); if (!item) throw new Error('找不到此本地会话；远程或归档会话暂不支持。');
    const [root, path] = await Promise.all([realpath(item.root), realpath(item.path)]);
    if (!within(root, path)) throw new Error('会话文件越过允许的会话目录。');
    return path;
  }
  async snapshot(threadId) {
    threadId=assertThreadId(threadId);
    const path=await this.rolloutPath(threadId);
    const handle = await open(path, 'r'); let raw;
    try {
      const stat = await handle.stat({bigint:true});
      if(stat.size>BigInt(Number.MAX_SAFE_INTEGER))throw Error('会话文件过大。');
      const s={ino:stat.ino,size:Number(stat.size),mtimeNs:stat.mtimeNs};
      const cached = this.snapshots.get(threadId);
      const signature = `${s.ino}:${s.size}:${s.mtimeNs}`;
      if (cached?.signature === signature) raw = cached.raw;
      else {
        const size = Math.min(this.maxTailBytes, s.size), start = s.size - size, buffer = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buffer, 0, size, start);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        const lines = text.split('\n'); if (start) lines.shift(); lines.pop();
        const contiguous = cached && s.ino === cached.ino && s.size > cached.size && start <= cached.size;
        // A bounded header establishes file identity; no conversation body is returned.
        const header = Buffer.alloc(Math.min(s.size, 65536)); await handle.read(header, 0, header.length, 0);
        const identity = extractTelemetry(header.toString('utf8').split('\n').slice(0, -1));
        // The header may contain an old token event. Only its identity and model are usable.
        const seed = contiguous ? { ...cached.raw } : { model: identity.model };
        seed.sessionId = identity.sessionId;
        raw = extractTelemetry(lines, seed);
        if (raw.sessionId?.toLowerCase() !== threadId) throw new Error('会话文件身份不匹配。');
        raw.threadId = threadId; raw.source = 'local-rollout';
        raw.revision = createHash('sha256').update(JSON.stringify([raw.measuredAt, raw.used, raw.window, raw.compactionEpoch])).digest('hex').slice(0, 16);
        this.snapshots.delete(threadId);
        this.snapshots.set(threadId, { signature, ino: s.ino, size: s.size, raw });
        if(this.snapshots.size>128)this.snapshots.delete(this.snapshots.keys().next().value);
      }
    } finally { await handle.close(); }
    const models = await this.modelCatalog();
    return normalizeSnapshot(raw, models.get(raw.model));
  }
}
