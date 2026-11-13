/**
 * 设置页 HTML 外壳：左侧固定分区导航 + 右侧内容区，配置页把桌宠与 AI 两块合并在一处。
 *
 * 页面只在本机回环上由 ./server 提供；CSP 是 `style-src 'self'`，所以这里不许出现内联样式，
 * 也不许内联脚本。桌宠配置面板的内容依赖 GET /config，初始只有一句占位文案。
 * 图标走设置页自己的公开资源路径（/standalone-ai/icon.png），内容读自包内 assets/logo.png，
 * 不复制第二份图；不能用插件路由 /logo——浏览器取 favicon 不带 Origin 也不带令牌，会被判成文件来源而 403。
 * 导航项以 `data-tab` 声明，脚本按约定找 `panel-<tab>`，新增分区只需照此加一对按钮与面板。
 * @module dsh-pet/src/standalone/settings-page/chrome
 */
import { POSTURE_COOLDOWN_CHOICES, POSTURE_SENSITIVITY_CHOICES, postureCooldownLabel } from './posture-settings.ts';
import { SCREEN_CONTEXT_VISION_NOTE } from './screen-context-settings.ts';

/** 一组单选。值只来自调用方给出的常量，不拼接外部字符串。 */
function choiceRow(
  name: string,
  legend: string,
  options: readonly { readonly value: string; readonly label: string }[],
): string {
  const items = options
    .map(
      (option) =>
        `<label class="choice"><input type="radio" name="${name}" id="${name}-${option.value}" value="${option.value}" disabled>${option.label}</label>`,
    )
    .join('');
  return `<div class="field"><span class="fieldLabel" id="${name}-label">${legend}</span><div class="choiceRow" role="radiogroup" aria-labelledby="${name}-label">${items}</div></div>`;
}

/** 坐姿守护卡片。控件在脚本里立刻发给正在运行的桌面宠物，不进「保存」草稿。 */
const postureCard = `<div class="card" id="posture-card"><div class="cardHead"><h2 class="cardTitle">坐姿守护</h2></div>
<p class="cardHint">用摄像头看坐姿。这里的改动会立刻发给正在运行的桌面宠物，不用点上面的保存。</p>
<label class="rowCheck"><input type="checkbox" id="posture-enabled" disabled><span class="rowCheckText"><span class="rowCheckTitle">启用坐姿守护</span><span class="rowCheckHint">打开后立刻开始监控，关闭后停止摄像头。</span></span></label>
<label class="rowCheck"><input type="checkbox" id="posture-paused" disabled><span class="rowCheckText"><span class="rowCheckTitle">暂停监控</span><span class="rowCheckHint">先停检测，摄像头窗口先留着。</span></span></label>
<div class="testRow"><button class="btn" id="posture-recalibrate" type="button" disabled>重新校准</button></div>
${choiceRow(
  'posture-sensitivity',
  '灵敏度',
  POSTURE_SENSITIVITY_CHOICES.map((item) => ({ value: item.value, label: item.label })),
)}
${choiceRow(
  'posture-cooldown',
  '冷却',
  POSTURE_COOLDOWN_CHOICES.map((seconds) => ({ value: String(seconds), label: postureCooldownLabel(seconds) })),
)}
<label class="rowCheck"><input type="checkbox" id="posture-beep" disabled><span class="rowCheckText"><span class="rowCheckTitle">蜂鸣</span><span class="rowCheckHint">提醒时响一声（与桌宠演出互不干扰）。</span></span></label>
<label class="rowCheck"><input type="checkbox" id="posture-pet" disabled><span class="rowCheckText"><span class="rowCheckTitle">桌宠演出</span><span class="rowCheckHint">提醒时让桌宠做对应动作。关掉后只走蜂鸣。</span></span></label>
<p class="status" id="posture-status" role="status" aria-live="polite">正在读取坐姿守护…</p>
<p class="status" id="posture-note" role="status" aria-live="polite"></p>
</div>`;

/** 屏幕感知卡片。控件立刻发给正在运行的桌面宠物，不进「保存」草稿。 */
const screenContextCard = `<div class="card" id="screen-context-card"><div class="cardHead"><h2 class="cardTitle">屏幕感知</h2></div>
<p class="cardHint">碎碎念触发时截一眼屏幕，图与历史一起生成那句话。这里的改动会立刻发给正在运行的桌面宠物，不用点上面的保存。${SCREEN_CONTEXT_VISION_NOTE}</p>
<label class="rowCheck"><input type="checkbox" id="screen-context-enabled" disabled><span class="rowCheckText"><span class="rowCheckTitle">启用</span><span class="rowCheckHint">打开后，每次碎碎念会截屏看一眼；关掉则碎碎念不再看屏。</span></span></label>
<div class="field"><label for="screen-context-titles">标题黑名单</label><textarea id="screen-context-titles" rows="4" spellcheck="false" disabled></textarea><p class="fieldHint">一行一个标题片段。窗口标题包含其中任一行时跳过截屏。</p></div>
<div class="field"><label for="screen-context-processes">进程黑名单</label><textarea id="screen-context-processes" rows="4" spellcheck="false" disabled></textarea><p class="fieldHint">一行一个进程名片段。进程名包含其中任一行时跳过截屏。</p></div>
<p class="fieldLabel" id="screen-context-summary-label">最近看屏</p>
<p class="cardHint" id="screen-context-summary" aria-labelledby="screen-context-summary-label">正在读取…</p>
<p class="status" id="screen-context-status" role="status" aria-live="polite">正在读取屏幕感知…</p>
<p class="status" id="screen-context-error" role="status" aria-live="polite"></p>
<p class="status" id="screen-context-note" role="status" aria-live="polite"></p>
</div>`;

/** 设置页 HTML。 */
export const settingsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><base href="/"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌宠设置</title><link rel="icon" type="image/png" href="/standalone-ai/icon.png"><link rel="stylesheet" href="/standalone-ai/settings.css">
<script src="/standalone-ai/settings.js" defer></script><script src="/standalone-ai/chat-panel.js" defer></script></head><body>
<main class="shell">
<aside class="side">
<div class="brand"><img class="brandLogo" src="/standalone-ai/icon.png" alt=""><span>桌宠</span></div>
<nav class="nav" aria-label="设置分区"><div class="navList" role="tablist">
<button type="button" class="navCell" role="tab" id="tab-chat" data-tab="chat" data-title="对话" aria-controls="panel-chat" aria-selected="true"><svg class="navGlyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.4h10a1.1 1.1 0 0 1 1.1 1.1v5.6A1.1 1.1 0 0 1 13 11.2H8.2L5 13.6v-2.4H3a1.1 1.1 0 0 1-1.1-1.1V4.5A1.1 1.1 0 0 1 3 3.4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg><span class="navLabel">对话</span></button>
<button type="button" class="navCell" role="tab" id="tab-config" data-tab="config" data-title="配置" aria-controls="panel-config" aria-selected="false"><svg class="navGlyph" viewBox="0 0 16 16" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M2.6 4.6h10.8M2.6 11.4h10.8"/><circle cx="6.2" cy="4.6" r="1.6" fill="currentColor" stroke="none"/><circle cx="9.8" cy="11.4" r="1.6" fill="currentColor" stroke="none"/></g></svg><span class="navLabel">配置</span></button>
</div></nav>
<div class="sideFoot">独立模式</div>
</aside>
<div class="main">
<div class="topbar"><h1 class="pageTitle" id="page-title">对话</h1><span class="dirty" id="dirty" hidden>有未保存的改动</span></div>
<div class="options">
<section class="panel" id="panel-config" role="tabpanel" aria-labelledby="tab-config" hidden>
<div class="scroll">
<div id="pet-cards"><p class="empty">正在读取本机配置…</p></div>
<div class="footer"><p class="status" id="pet-status" role="status" aria-live="polite"></p><button class="btn primary" id="pet-save" type="button" disabled>保存</button></div>
${postureCard}
${screenContextCard}
<form id="settings" aria-describedby="privacy">
<div class="card"><div class="cardHead"><h2 class="cardTitle">模型连接</h2></div>
<p class="cardHint">独立模式自己连服务商，不经过 DSH；所有配置只保存在当前机器。</p>
<div class="field"><span class="fieldLabel" id="protocol-label">接口协议</span><div id="protocol-host"></div></div>
<div class="field"><label for="baseUrl">接口地址（Base URL）</label><input id="baseUrl" name="baseUrl" type="url" placeholder="https://example.com/v1" maxlength="2048" spellcheck="false" aria-describedby="endpoint-note"><p class="fieldHint" id="endpoint-note">服务商提供的基础接口地址，支持 HTTP 与 HTTPS，通常以 /v1 结尾。不要把密钥放进地址。</p></div>
<div class="field"><label for="model">模型名称</label><div class="combo" id="model-combo"><input id="model" name="model" type="text" maxlength="200" placeholder="填写或拉取服务商的模型 ID，例如 deepseek-chat" spellcheck="false" aria-describedby="model-note"><button id="model-toggle" class="comboToggle" type="button" aria-label="拉取并选择模型" aria-haspopup="listbox" aria-expanded="false"></button></div><p class="fieldHint" id="model-note">可以直接手填；点右侧箭头向端点拉取可用列表后选择。拉取只用本次填写的地址与密钥，不会保存。</p><p class="status" id="model-result" role="status" aria-live="polite"></p></div>
<div class="field"><label for="apiKey">API 密钥 <span class="hintInline" id="key-state">尚未读取</span></label><input id="apiKey" name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="留空保留已保存的密钥" aria-describedby="key-note"><div class="keyActions" id="key-actions" hidden><button id="key-delete" class="btn ghost" type="button">删除已保存的密钥</button></div><p id="key-note" class="fieldHint">密钥只写入本机配置，不会回显。留空会保留旧密钥，要彻底删除请点上面的按钮。</p></div>
<div class="field"><span class="fieldLabel" id="balance-provider-label">余额查询服务商</span><div id="balance-provider-host"></div><p class="fieldHint" id="balance-provider-note">可选：选定后可用上面保存的密钥查询余额，不选则不查询。余额接口只有 DeepSeek 官方、opencode Go 与 commandcode 提供，且密钥必须属于所选服务商。</p><div class="testRow"><button id="balance-btn" class="btn ghost" type="button" disabled>查询余额</button><span id="balance-result" class="status" role="status" aria-live="polite"></span></div></div>
<div class="testRow"><button id="test-btn" class="btn" type="button">测试连接</button><span id="test-result" class="status" role="status" aria-live="polite"></span></div>
</div>
<p id="privacy" class="fineprint">所有配置与密钥仅保存在当前机器。</p>
<div class="footer"><p class="status" id="status" role="status" aria-live="polite">正在读取本机设置…</p><button id="save" class="btn primary" type="submit" disabled>保存</button></div>
</form>
</div>
</section>
<section class="panel" id="panel-chat" role="tabpanel" aria-labelledby="tab-chat">
<div class="pet-chat-host" id="pet-chat-root"></div>
</section>
</div>
</div>
</main>
<noscript>需要启用 JavaScript 才能保存设置。请从桌宠右键菜单打开本页。</noscript>
</body></html>`;
