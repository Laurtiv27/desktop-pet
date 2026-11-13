/**
 * 设置页「屏幕感知」：启用与黑名单立刻发给控制器。
 *
 * 碎碎念触发时才截屏；不再配置独立间隔。
 * 不进桌宠配置的保存草稿。读 `/screen-context/config`，写 `/screen-context/command`。
 * @module dsh-pet/src/standalone/settings-page/script/screen-context
 */
import {
  SCREEN_CONTEXT_COMMAND_ROUTE,
  SCREEN_CONTEXT_CONFIG_ROUTE,
  SCREEN_CONTEXT_EMPTY_SUMMARY,
  SCREEN_CONTEXT_HELPER_OFFLINE,
  SCREEN_CONTEXT_STATUS_LABELS,
} from '../screen-context-settings.ts';

/** 生成屏幕感知分区片段。 */
export function screenContextScript(): string {
  return `
const SCREEN_CONTEXT_HELPER_OFFLINE = ${JSON.stringify(SCREEN_CONTEXT_HELPER_OFFLINE)};
const SCREEN_CONTEXT_EMPTY_SUMMARY = ${JSON.stringify(SCREEN_CONTEXT_EMPTY_SUMMARY)};
const SCREEN_CONTEXT_STATUS_LABELS = ${JSON.stringify(SCREEN_CONTEXT_STATUS_LABELS)};
const SCREEN_CONTEXT_CONFIG_ROUTE = ${JSON.stringify(SCREEN_CONTEXT_CONFIG_ROUTE)};
const SCREEN_CONTEXT_COMMAND_ROUTE = ${JSON.stringify(SCREEN_CONTEXT_COMMAND_ROUTE)};
const SCREEN_CONTEXT_CONTROL_IDS = [
  'screen-context-enabled',
  'screen-context-titles',
  'screen-context-processes',
];
let screenContextView = null;
let screenContextBusy = false;
let screenContextWired = false;
let screenContextEpoch = 0;
let screenContextTimer = 0;

function screenContextLines(id) {
  const node = byId(id);
  const text = node && typeof node.value === 'string' ? node.value : '';
  return text.split(/\\r?\\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function screenContextState(view) {
  return view && view.state && typeof view.state === 'object' ? view.state : {};
}

function screenContextSummaryText(view) {
  const state = screenContextState(view);
  const text = typeof state.text === 'string' ? state.text.trim() : '';
  return text || SCREEN_CONTEXT_EMPTY_SUMMARY;
}

function screenContextStatusText(view) {
  if (!view || view.helper === false) return SCREEN_CONTEXT_HELPER_OFFLINE;
  const state = screenContextState(view);
  const status = typeof state.status === 'string' ? state.status : '';
  return SCREEN_CONTEXT_STATUS_LABELS[status] || '未知';
}

function screenContextErrorText(view) {
  const state = screenContextState(view);
  const lastError = typeof state.lastError === 'string' ? state.lastError.trim() : '';
  const errorMessage = typeof state.errorMessage === 'string' ? state.errorMessage.trim() : '';
  const skipNote = typeof state.skipNote === 'string' ? state.skipNote.trim() : '';
  return lastError || errorMessage || skipNote;
}

function screenContextStatusFailed(view) {
  if (!view || view.helper === false) return true;
  const state = screenContextState(view);
  if (state.status === 'error') return true;
  const lastError = typeof state.lastError === 'string' ? state.lastError.trim() : '';
  const errorMessage = typeof state.errorMessage === 'string' ? state.errorMessage.trim() : '';
  return lastError !== '' || errorMessage !== '';
}

function setScreenContextLocked(locked) {
  for (const id of SCREEN_CONTEXT_CONTROL_IDS) {
    const node = byId(id);
    if (node) node.disabled = !!locked;
  }
}

function screenContextEditing() {
  const active = document.activeElement;
  if (!active || !active.id) return false;
  return active.id === 'screen-context-titles'
    || active.id === 'screen-context-processes';
}

function applyScreenContextView(data) {
  screenContextView = data || null;
  const cfg = (data && data.config) || {};
  const blacklist = cfg.blacklist || {};
  setChecked('screen-context-enabled', cfg.enabled === true);
  if (!screenContextEditing()) {
    const titles = byId('screen-context-titles');
    const processes = byId('screen-context-processes');
    if (titles) titles.value = Array.isArray(blacklist.titles) ? blacklist.titles.join('\\n') : '';
    if (processes) processes.value = Array.isArray(blacklist.processes) ? blacklist.processes.join('\\n') : '';
  }
  const summary = byId('screen-context-summary');
  if (summary) summary.textContent = screenContextSummaryText(data);
  setStatus(byId('screen-context-status'), screenContextStatusText(data), screenContextStatusFailed(data) ? 'error' : '');
  const errorText = screenContextErrorText(data);
  setStatus(byId('screen-context-error'), errorText, screenContextStatusFailed(data) && errorText ? 'error' : '');
}

async function screenContextCommand(body) {
  if (screenContextBusy) return;
  screenContextBusy = true;
  screenContextEpoch += 1;
  setScreenContextLocked(true);
  const note = byId('screen-context-note');
  try {
    const data = await callApi('POST', SCREEN_CONTEXT_COMMAND_ROUTE, body);
    if (!data || data.ok === false) throw new Error((data && (data.message || data.error)) || '屏幕感知控制失败');
    applyScreenContextView(data);
    setStatus(note, '已生效', 'ok');
  } catch (error) {
    if (screenContextView) applyScreenContextView(screenContextView);
    setStatus(note, (error && error.message) || String(error), 'error');
  } finally {
    screenContextBusy = false;
    setScreenContextLocked(false);
  }
}

function readScreenContextPatch() {
  return {
    op: 'patch',
    patch: {
      blacklist: {
        titles: screenContextLines('screen-context-titles'),
        processes: screenContextLines('screen-context-processes'),
      },
    },
  };
}

function wireScreenContext() {
  if (screenContextWired) return;
  screenContextWired = true;
  const enabled = byId('screen-context-enabled');
  if (enabled && enabled.addEventListener) {
    enabled.addEventListener('change', () => {
      void screenContextCommand({ op: enabled.checked ? 'enable' : 'disable' });
    });
  }
  const bindPatch = (id) => {
    const node = byId(id);
    if (!node || !node.addEventListener) return;
    node.addEventListener('change', () => {
      try {
        void screenContextCommand(readScreenContextPatch());
      } catch (error) {
        setStatus(byId('screen-context-note'), (error && error.message) || String(error), 'error');
        if (screenContextView) applyScreenContextView(screenContextView);
      }
    });
  };
  bindPatch('screen-context-titles');
  bindPatch('screen-context-processes');
}

async function refreshScreenContext() {
  if (screenContextBusy) return;
  const epoch = screenContextEpoch;
  try {
    const data = await callApi('GET', SCREEN_CONTEXT_CONFIG_ROUTE);
    if (epoch !== screenContextEpoch || screenContextBusy) return;
    if (!data || data.ok === false) throw new Error((data && (data.message || data.error)) || '读取屏幕感知失败');
    applyScreenContextView(data);
    wireScreenContext();
    setScreenContextLocked(false);
  } catch (error) {
    setStatus(byId('screen-context-status'), (error && error.message) || String(error), 'error');
    wireScreenContext();
    setScreenContextLocked(false);
  }
}

function loadScreenContext() {
  void refreshScreenContext();
  if (screenContextTimer || typeof setInterval !== 'function') return;
  screenContextTimer = setInterval(() => {
    void refreshScreenContext();
  }, 3000);
}
`;
}
