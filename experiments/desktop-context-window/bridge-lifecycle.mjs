import {mkdir, realpath} from 'node:fs/promises';
import {unlinkSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';

export const launchExitCode = error => error.code === 'LOADER_RESTART_REQUIRED' ? 4 : 1;

export async function prepareCodexHome(path) {
  await mkdir(path, {recursive: true, mode: 0o700});
  return realpath(path);
}

// The bundled Windows runtime supplies SQLite. Its exclusive file lock belongs
// to this OS process and is released even if the bridge exits unexpectedly.
export async function acquireBridgeLease(localAppData, pid, born) {
  if (!localAppData || !isAbsolute(localAppData) || !Number.isSafeInteger(pid) || pid < 1 ||
      typeof born !== 'string' || !/^\d{1,20}$/.test(born)) throw Error('无法确定本用户的后台租约。');
  const directory = join(localAppData, 'ContextLens', 'bridge-leases');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const {DatabaseSync} = await import('node:sqlite');
  const path = join(directory, pid + '-' + born + '.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec('BEGIN EXCLUSIVE');
    return {close() {
      db.close();
      // Windows denies deletion while a new holder has the file open.
      if (process.platform === 'win32') {
        try { unlinkSync(path); } catch { /* A leftover empty database holds no lease. */ }
      }
    }};
  } catch (error) {
    db.close();
    if (error.errcode === 5) return null; // SQLITE_BUSY from another live holder.
    throw error;
  }
}
