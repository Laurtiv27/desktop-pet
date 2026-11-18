/**
 * Electron：透明窗捕获 Spine 演示帧 → PNG 序列（供 ffmpeg 合成 GIF）。
 * 用法：npx electron scripts/capture-spine-preview.mjs
 */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets', 'preview', '_spine_frames');
const html = path.join(root, 'scripts', 'capture-spine-preview.html');
const FRAME_COUNT = 24;
const INTERVAL_MS = 80;

app.whenReady().then(async () => {
  if (existsSync(outDir)) {
    for (const f of readdirSync(outDir)) rmSync(path.join(outDir, f), { force: true });
  }
  mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  await win.loadFile(html);
  // wait ready
  for (let i = 0; i < 100; i++) {
    const title = await win.webContents.executeJavaScript('document.title');
    if (title === 'spine-ready') break;
    if (String(title).includes('fail')) {
      console.error('spine load failed:', title);
      app.exit(1);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 400));

  for (let i = 0; i < FRAME_COUNT; i++) {
    // WebGL 内容 capturePage 常为空；从 canvas 读 preserveDrawingBuffer。
    const dataUrl = await win.webContents.executeJavaScript(
      `(function(){ const c=window.__glCanvas; return c ? c.toDataURL('image/png') : ''; })()`,
    );
    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      console.error('empty canvas frame', i);
      app.exit(2);
      return;
    }
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    writeFileSync(path.join(outDir, `frame_${String(i + 1).padStart(4, '0')}.png`), Buffer.from(b64, 'base64'));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  console.log('[spine-preview] wrote', FRAME_COUNT, 'frames to', outDir);
  app.exit(0);
});
