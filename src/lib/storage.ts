/**
 * NOIRMusic Web — safe persistent storage.
 *
 * A self-contained replacement for NOIR's safeStorage with the same contract:
 * Safari private mode and quota failures throw on plain localStorage, so every
 * access is guarded. A write that fails does not take the caller down — the
 * caller decides whether the library must be presented as "ephemeral".
 */

const AVAILABLE_KEY = '__noirmusic_storage_probe__';

let availabilityChecked = false;
let storageWorks = true;

function localStorageHandle(): Storage | null {
  // Browsers expose localStorage on window; Node (≥22, used by the test
  // runner) exposes it on globalThis. Guard both.
  const candidate =
    typeof globalThis !== 'undefined'
      ? (globalThis as { localStorage?: Storage }).localStorage
      : undefined;
  return candidate ?? null;
}

function probe(): boolean {
  if (availabilityChecked) return storageWorks;
  availabilityChecked = true;
  try {
    const handle = localStorageHandle();
    if (!handle) {
      storageWorks = false;
      return false;
    }
    const probeKey = `${AVAILABLE_KEY}_${Date.now()}`;
    handle.setItem(probeKey, '1');
    handle.removeItem(probeKey);
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
  return storageWorks;
}

/** True when writes will not survive (private mode, disabled storage). */
export function isPersistenceLimited(): boolean {
  return !probe();
}

export function storageRead(key: string): string | null {
  const handle = localStorageHandle();
  if (!probe() || !handle) return null;
  try {
    return handle.getItem(key);
  } catch {
    return null;
  }
}

export function storageWrite(key: string, value: string): boolean {
  const handle = localStorageHandle();
  if (!probe() || !handle) return false;
  try {
    handle.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key: string): void {
  const handle = localStorageHandle();
  if (!probe() || !handle) return;
  try {
    handle.removeItem(key);
  } catch {
    // ignore
  }
}
