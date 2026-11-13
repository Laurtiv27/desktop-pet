import type { ScreenContextState, ScreenContextStatus } from './types.ts';

export const SCREEN_CONTEXT_SKIP_NOTE = '本轮因黑名单跳过截屏';

export type ScreenContextStoreSnapshot = ScreenContextState & {
  lastError?: string;
  skipNote?: string;
};

type PersistedState = {
  text: string;
  updatedAt: number;
};

export type ScreenContextStoreDeps = {
  persistSummary: boolean;
  readFile?: (path: string) => string;
  writeFile?: (path: string, data: string) => void;
  statePath?: string;
};

export type ScreenContextStore = {
  get(): ScreenContextStoreSnapshot;
  setOk(text: string, now: number): void;
  setSkipped(now: number): void;
  setError(message: string, now: number): void;
  clear(): void;
  loadFromDisk?: () => void;
};

function idleSnapshot(): ScreenContextStoreSnapshot {
  return { status: 'idle', text: '', updatedAt: 0 };
}

export function createScreenContextStore(deps: ScreenContextStoreDeps): ScreenContextStore {
  let status: ScreenContextStatus = 'idle';
  let lastOkText = '';
  let lastOkAt = 0;
  let lastError: string | undefined;
  let skipNote: string | undefined;

  const canPersist =
    deps.persistSummary && typeof deps.writeFile === 'function' && typeof deps.statePath === 'string';

  function persistOk(text: string, updatedAt: number): void {
    if (!canPersist) return;
    const payload: PersistedState = { text, updatedAt };
    deps.writeFile!(deps.statePath!, JSON.stringify(payload, null, 2));
  }

  function persistClear(): void {
    if (!canPersist) return;
    deps.writeFile!(deps.statePath!, JSON.stringify({ text: '', updatedAt: 0 }, null, 2));
  }

  function get(): ScreenContextStoreSnapshot {
    const snapshot: ScreenContextStoreSnapshot = {
      status,
      text: lastOkText,
      updatedAt: lastOkAt,
    };
    if (lastError !== undefined) {
      snapshot.lastError = lastError;
      snapshot.errorMessage = lastError;
    }
    if (skipNote !== undefined) {
      snapshot.skipNote = skipNote;
    }
    return snapshot;
  }

  function setOk(text: string, now: number): void {
    status = 'ok';
    lastOkText = text;
    lastOkAt = now;
    lastError = undefined;
    skipNote = undefined;
    persistOk(text, now);
  }

  function setSkipped(_now: number): void {
    status = 'skipped';
    lastError = undefined;
    skipNote = SCREEN_CONTEXT_SKIP_NOTE;
  }

  function setError(message: string, _now: number): void {
    status = 'error';
    lastError = message;
    skipNote = undefined;
  }

  function clear(): void {
    status = 'idle';
    lastOkText = '';
    lastOkAt = 0;
    lastError = undefined;
    skipNote = undefined;
    persistClear();
  }

  function loadFromDisk(): void {
    if (!deps.persistSummary || typeof deps.readFile !== 'function' || !deps.statePath) return;
    try {
      const raw = deps.readFile(deps.statePath);
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
      if (text && updatedAt > 0) {
        status = 'ok';
        lastOkText = text;
        lastOkAt = updatedAt;
        lastError = undefined;
        skipNote = undefined;
      } else {
        status = 'idle';
        lastOkText = '';
        lastOkAt = 0;
        lastError = undefined;
        skipNote = undefined;
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  const store: ScreenContextStore = {
    get,
    setOk,
    setSkipped,
    setError,
    clear,
  };

  if (deps.persistSummary && typeof deps.readFile === 'function' && deps.statePath) {
    store.loadFromDisk = loadFromDisk;
  }

  return store;
}
