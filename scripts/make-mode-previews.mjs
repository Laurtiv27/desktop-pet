/**
 * Build README mode preview GIFs (transparent background).
 * webm ← maid idle GIF；glb ← Blender 渲染 Fox Survey。
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = path.join(root, 'assets', 'preview');
const ffmpeg =
  process.env.FFMPEG ||
  'D:\\AIModel\\AI_Workspace\\Illustrated_Summary\\tools\\ffmpeg\\bin\\ffmpeg.exe';
const blender =
  process.env.BLENDER ||
  'D:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe';

function run(cmd, args) {
  console.log('>', cmd, args.join(' '));
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

function pngSequenceToGif(frameDir, outGif) {
  const frames = readdirSync(frameDir)
    .filter((f) => /^frame_.*\.png$/i.test(f) || /^\d+\.png$/i.test(f))
    .sort();
  if (!frames.length) throw new Error(`no frames in ${frameDir}`);
  // Normalize names to frame_0001.png for ffmpeg
  const norm = path.join(frameDir, '_norm');
  mkdirSync(norm, { recursive: true });
  for (const f of readdirSync(norm)) rmSync(path.join(norm, f));
  frames.forEach((f, i) => {
    copyFileSync(path.join(frameDir, f), path.join(norm, `frame_${String(i + 1).padStart(4, '0')}.png`));
  });
  const palette = path.join(norm, 'palette.png');
  run(ffmpeg, [
    '-y',
    '-framerate',
    '12',
    '-i',
    path.join(norm, 'frame_%04d.png'),
    '-vf',
    'scale=512:512:flags=lanczos,palettegen=reserve_transparent=1',
    palette,
  ]);
  run(ffmpeg, [
    '-y',
    '-framerate',
    '12',
    '-i',
    path.join(norm, 'frame_%04d.png'),
    '-i',
    palette,
    '-lavfi',
    'scale=512:512:flags=lanczos[x];[x][1:v]paletteuse=alpha_threshold=128',
    '-gifflags',
    '+transdiff',
    '-loop',
    '0',
    outGif,
  ]);
}

// webm
copyFileSync(path.join(preview, 'daiji-huxi-xiuxian.gif'), path.join(preview, 'mode-webm.gif'));
console.log('[preview] mode-webm.gif');

// fox / glb
const foxFrames = path.join(preview, '_fox_frames');
mkdirSync(foxFrames, { recursive: true });
for (const f of readdirSync(foxFrames)) {
  try {
    rmSync(path.join(foxFrames, f), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
run(blender, [
  '--background',
  '--python',
  path.join(root, 'scripts', 'blender', 'render_fox_preview.py'),
  '--',
  path.join(root, 'assets', 'model3d', 'model3d-demo', 'Fox.glb'),
  foxFrames,
  '24',
]);
pngSequenceToGif(foxFrames, path.join(preview, 'mode-glb.gif'));
console.log('[preview] mode-glb.gif');
writeFileSync(path.join(preview, '.gitkeep-fox'), '');
