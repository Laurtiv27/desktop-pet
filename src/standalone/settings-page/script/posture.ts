/**
 * 设置页「坐姿守护」：开关、灵敏度、冷却和提醒方式立刻发给控制器。
 *
 * 不进桌宠配置的保存草稿。读 `/posture/config`，写 `/posture/command`。
 * 控件在第一次读到应答之后才可点；失败时把勾选恢复成上一份成功的应答。
 * @module dsh-pet/src/standalone/settings-page/script/posture
 */
import { POSTURE_COMMAND_ROUTE, POSTURE_CONFIG_ROUTE, POSTURE_HELPER_OFFLINE } from '../posture-settings.ts';

/** 生成坐姿分区片段。 */
export function postureScript(): string {
  return `
const POSTURE_HELPER_OFFLINE = ${JSON.stringify(POSTURE_HELPER_OFFLINE)};
const POSTURE_CONFIG_ROUTE = ${JSON.stringify(POSTURE_CONFIG_ROUTE)};
const POSTURE_COMMAND_ROUTE = ${JSON.stringify(POSTURE_COMMAND_ROUTE)};
const POSTURE_CONTROL_IDS = [
  'posture-enabled',
  'posture-paused',
  'posture-recalibrate',
  'posture-beep',
  'posture-pet',
  'posture-sensitivity-strict',
  'posture-sensitivity-standard',
  'posture-sensitivity-loose',
  'posture-cooldown-5',
  'posture-cooldown-10',
  'posture-cooldown-30',
];
let postureView = null;
let postureBusy = false;
let postureWired = false;
let postureEpoch = 0;
let postureTimer = 0;

function postureStatusText(view) {
  if (!view || view.helper === false) return POSTURE_HELPER_OFFLINE;
  const runtime = view.runtime && typeof view.runtime === 'object' ? view.runtime : {};
  const status = typeof runtime.status === 'string' && runtime.status.trim() ? runtime.status.trim() : '未知';
  const error = typeof runtime.error === 'string' ? runtime.error.trim() : '';
  return error ? status + '（' + error + '）' : status;
}

function postureStatusIsError(view) {
  if (!view || view.helper === false) return true;
  const runtime = view.runtime && typeof view.runtime === 'object' ? view.runtime : {};
  return typeof runtime.error === 'string' && runtime.error.trim() !== '';
}

function setChecked(id, value) {
  const node = byId(id);
  if (node) node.checked = !!value;
}

function setPostureLocked(locked) {
  for (const id of POSTURE_CONTROL_IDS) {
    const node = byId(id);
    if (node) node.disabled = !!locked;
  }
}

function applyPostureView(data) {
  postureView = data || null;
  const cfg = (data && data.config) || {};
  setChecked('posture-enabled', cfg.enabled === true);
  setChecked('posture-paused', cfg.paused === true);
  setChecked('posture-beep', cfg.beep === true);
  setChecked('posture-pet', cfg.petPerform === true);
  const sensitivity = String(cfg.sensitivity || '');
  setChecked('posture-sensitivity-strict', sensitivity === 'strict');
  setChecked('posture-sensitivity-standard', sensitivity === 'standard');
  setChecked('posture-sensitivity-loose', sensitivity === 'loose');
  const cooldown = String(cfg.cooldown);
  setChecked('posture-cooldown-5', cooldown === '5');
  setChecked('posture-cooldown-10', cooldown === '10');
  setChecked('posture-cooldown-30', cooldown === '30');
  setStatus(byId('posture-status'), postureStatusText(data), postureStatusIsError(data) ? 'error' : '');
}

async function postureCommand(body) {
  if (postureBusy) return;
  postureBusy = true;
  postureEpoch += 1;
  setPostureLocked(true);
  const note = byId('posture-note');
  try {
    const data = await callApi('POST', POSTURE_COMMAND_ROUTE, body);
    if (!data || data.ok === false) throw new Error((data && (data.message || data.error)) || '坐姿控制失败');
    applyPostureView(data);
    setStatus(note, '已生效', 'ok');
  } catch (error) {
    if (postureView) applyPostureView(postureView);
    setStatus(note, (error && error.message) || String(error), 'error');
  } finally {
    postureBusy = false;
    setPostureLocked(false);
  }
}

function wirePosture() {
  if (postureWired) return;
  postureWired = true;
  const bind = (id, read) => {
    const node = byId(id);
    if (!node || !node.addEventListener) return;
    node.addEventListener('change', () => {
      void postureCommand(read(node));
    });
  };
  bind('posture-enabled', (node) => ({ op: node.checked ? 'enable' : 'disable' }));
  bind('posture-paused', (node) => ({ op: node.checked ? 'pause' : 'resume' }));
  bind('posture-beep', (node) => ({ op: 'patch', patch: { beep: node.checked === true } }));
  bind('posture-pet', (node) => ({ op: 'patch', patch: { petPerform: node.checked === true } }));
  bind('posture-sensitivity-strict', () => ({ op: 'patch', patch: { sensitivity: 'strict' } }));
  bind('posture-sensitivity-standard', () => ({ op: 'patch', patch: { sensitivity: 'standard' } }));
  bind('posture-sensitivity-loose', () => ({ op: 'patch', patch: { sensitivity: 'loose' } }));
  bind('posture-cooldown-5', () => ({ op: 'patch', patch: { cooldown: 5 } }));
  bind('posture-cooldown-10', () => ({ op: 'patch', patch: { cooldown: 10 } }));
  bind('posture-cooldown-30', () => ({ op: 'patch', patch: { cooldown: 30 } }));
  const recalibrate = byId('posture-recalibrate');
  if (recalibrate && recalibrate.addEventListener) {
    recalibrate.addEventListener('click', () => {
      void postureCommand({ op: 'recalibrate' });
    });
  }
}

async function refreshPosture() {
  if (postureBusy) return;
  const epoch = postureEpoch;
  try {
    const data = await callApi('GET', POSTURE_CONFIG_ROUTE);
    if (epoch !== postureEpoch || postureBusy) return;
    if (!data || data.ok === false) throw new Error((data && (data.message || data.error)) || '读取坐姿守护失败');
    applyPostureView(data);
    wirePosture();
    setPostureLocked(false);
  } catch (error) {
    setStatus(byId('posture-status'), (error && error.message) || String(error), 'error');
    wirePosture();
    setPostureLocked(false);
  }
}

function loadPosture() {
  void refreshPosture();
  if (postureTimer || typeof setInterval !== 'function') return;
  postureTimer = setInterval(() => {
    void refreshPosture();
  }, 3000);
}
`;
}
