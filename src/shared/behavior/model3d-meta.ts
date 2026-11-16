export type Model3dMeta = {
  clips: Record<string, string>;
  walkSpeedPx: number;
  scale: number;
  pivot: { x: number; y: number; z: number };
  camera: { kind: 'perspective' | 'ortho'; fov?: number; distance: number; frustum?: number };
  facingMode: 'mirror' | 'turnClip';
  autoBehavior?: boolean;
  glb: string;
};
export const DEFAULT_WALK_SPEED_PX = 120;

export function parseModel3dMeta(raw: unknown): Model3dMeta | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.clips !== 'object' || record.clips === null || Array.isArray(record.clips)) return null;
  const clips: Record<string, string> = {};
  for (const [k, v] of Object.entries(record.clips as Record<string, unknown>)) {
    if (typeof v === 'string' && v) clips[k] = v;
  }
  if (Object.keys(clips).length === 0) return null;

  let walkSpeedPx = DEFAULT_WALK_SPEED_PX;
  if (typeof record.walkSpeedPx === 'number' && Number.isFinite(record.walkSpeedPx) && record.walkSpeedPx > 0) {
    walkSpeedPx = record.walkSpeedPx;
  }
  let scale = 1;
  if (typeof record.scale === 'number' && Number.isFinite(record.scale) && record.scale > 0) scale = record.scale;

  const pivot = { x: 0, y: 0, z: 0 };
  if (record.pivot && typeof record.pivot === 'object' && !Array.isArray(record.pivot)) {
    const p = record.pivot as Record<string, unknown>;
    for (const k of ['x', 'y', 'z'] as const) {
      if (typeof p[k] === 'number' && Number.isFinite(p[k])) pivot[k] = p[k];
    }
  }

  let camera: Model3dMeta['camera'] = { kind: 'perspective', fov: 35, distance: 4 };
  if (record.camera && typeof record.camera === 'object' && !Array.isArray(record.camera)) {
    const c = record.camera as Record<string, unknown>;
    const kind = c.kind === 'ortho' ? 'ortho' : 'perspective';
    const distance =
      typeof c.distance === 'number' && Number.isFinite(c.distance) && c.distance > 0 ? c.distance : 4;
    camera = { kind, distance };
    if (kind === 'perspective') {
      camera.fov = typeof c.fov === 'number' && c.fov > 0 ? c.fov : 35;
    } else if (typeof c.frustum === 'number' && c.frustum > 0) {
      camera.frustum = c.frustum;
    }
  }

  const facingMode = record.facingMode === 'turnClip' ? 'turnClip' : 'mirror';
  const glb = typeof record.glb === 'string' && record.glb.trim() ? record.glb.trim() : 'character.glb';
  const out: Model3dMeta = { clips, walkSpeedPx, scale, pivot, camera, facingMode, glb };
  if (record.autoBehavior === false) out.autoBehavior = false;
  else if (record.autoBehavior === true) out.autoBehavior = true;
  return out;
}
