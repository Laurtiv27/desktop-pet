'use strict';
/**
 * Windows 上枚举带主窗口标题的进程，供屏幕感知黑名单匹配。
 * @module dsh-pet/runtime/electron-helper/main/screen-windows
 */

const { promisify } = require('node:util');
const { exec: defaultExec } = require('node:child_process');

const PS_LIST =
  "Get-Process | Where-Object { $_.MainWindowTitle } | " +
  "Select-Object @{N='title';E={$_.MainWindowTitle}}, @{N='processName';E={$_.ProcessName}} | " +
  'ConvertTo-Json -Compress';

/**
 * @param {string} stdout
 * @returns {Array<{ title: string, processName: string }>}
 */
function parseWindowsJson(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((row) => row && typeof row.title === 'string' && row.title.trim())
    .map((row) => ({
      title: row.title.trim(),
      processName: String(row.processName || '').trim(),
    }));
}

/**
 * @param {object} [deps]
 * @param {(cmd: string, opts?: object) => Promise<{ stdout: string, stderr: string }>} [deps.exec]
 * @param {(msg: string, ...rest: unknown[]) => void} [deps.log]
 * @param {string} [deps.platform]
 */
function createWindowLister(deps = {}) {
  const execFn = deps.exec || promisify(defaultExec);
  const log = deps.log || ((...args) => console.log(...args));
  const platform = deps.platform !== undefined ? deps.platform : process.platform;

  async function listOpenWindows() {
    if (platform !== 'win32') {
      log('[dsh-pet-screen-windows] skip window list: non-Windows platform');
      return [];
    }
    const cmd =
      'powershell -NoProfile -NonInteractive -Command "' + PS_LIST.replace(/"/g, '\\"') + '"';
    try {
      const { stdout } = await execFn(cmd, {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      });
      return parseWindowsJson(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('[dsh-pet-screen-windows] list windows failed:', message);
      return [];
    }
  }

  return { listOpenWindows };
}

module.exports = { createWindowLister, parseWindowsJson };
