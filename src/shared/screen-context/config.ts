import { DEFAULT_SCREEN_CONTEXT_CONFIG } from './defaults.ts';
import type { ScreenContextConfig } from './types.ts';

export { DEFAULT_SCREEN_CONTEXT_CONFIG } from './defaults.ts';
export type { ScreenContextConfig, ScreenContextState, ScreenContextStatus } from './types.ts';

const CONFIG_KEYS: Array<keyof Omit<ScreenContextConfig, 'blacklist'>> = [
  'enabled',
  'intervalSec',
  'persistSummary',
];

function mergeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

function mergeScreenContextConfig(parsed: unknown): ScreenContextConfig {
  const out: ScreenContextConfig = {
    ...DEFAULT_SCREEN_CONTEXT_CONFIG,
    blacklist: {
      titles: [...DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.titles],
      processes: [...DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.processes],
    },
  };
  if (!parsed || typeof parsed !== 'object') return out;
  const obj = parsed as Record<string, unknown>;

  for (const key of CONFIG_KEYS) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (key === 'intervalSec') {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out.intervalSec = value;
      }
      continue;
    }
    if (typeof value === 'boolean') {
      out[key] = value;
    }
  }

  if (obj.blacklist && typeof obj.blacklist === 'object') {
    const bl = obj.blacklist as Record<string, unknown>;
    if ('titles' in bl) {
      out.blacklist.titles = mergeStringArray(bl.titles, DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.titles);
    }
    if ('processes' in bl) {
      out.blacklist.processes = mergeStringArray(
        bl.processes,
        DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.processes,
      );
    }
  }

  return out;
}

export function screenContextConfigPath(dshHome: string): string {
  return `${dshHome}/dsh-pet/screen-context.json`;
}

export function loadScreenContextConfig(
  readFile: () => string,
  _configPath: string,
): ScreenContextConfig {
  try {
    const raw = readFile();
    return mergeScreenContextConfig(JSON.parse(raw));
  } catch {
    return {
      ...DEFAULT_SCREEN_CONTEXT_CONFIG,
      blacklist: {
        titles: [...DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.titles],
        processes: [...DEFAULT_SCREEN_CONTEXT_CONFIG.blacklist.processes],
      },
    };
  }
}

export function saveScreenContextConfig(
  writeFile: (path: string, content: string) => void,
  configPath: string,
  cfg: ScreenContextConfig,
): void {
  writeFile(configPath, JSON.stringify(cfg, null, 2));
}
