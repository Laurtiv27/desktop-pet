export type SpineMeta = {
  /** 槽位或任意动画别名 → 骨架内真实动画名 */
  clips: Record<string, string>;
  walkSpeedPx: number;
  defaultSkin: string;
  /** 缺省 true；false = 不自动漫游/乱表演（仅待机，待接窗口互动） */
  autoBehavior?: boolean;
  /** 骨架文件名（相对资源目录），默认 spineboy-pro.skel */
  skeleton?: string;
  /** 图集文件名（相对资源目录），默认 spineboy-pma.atlas */
  atlas?: string;
  /** 运行时主版本：`3.8` 或省略（按 4.x） */
  runtime?: string;
};

export const DEFAULT_WALK_SPEED_PX = 120;

export function parseSpineMeta(raw: unknown): SpineMeta | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  if (
    typeof record.clips !== 'object' ||
    record.clips === null ||
    Array.isArray(record.clips)
  ) {
    return null;
  }

  const clipsIn = record.clips as Record<string, unknown>;
  const clips: Record<string, string> = {};
  let hasStringClip = false;

  for (const [key, value] of Object.entries(clipsIn)) {
    if (typeof value !== 'string' || !value) {
      continue;
    }
    hasStringClip = true;
    clips[key] = value;
  }

  if (!hasStringClip) {
    return null;
  }

  let defaultSkin = 'default';
  if (typeof record.defaultSkin === 'string' && record.defaultSkin.length > 0) {
    defaultSkin = record.defaultSkin;
  }

  let walkSpeedPx = DEFAULT_WALK_SPEED_PX;
  if (
    typeof record.walkSpeedPx === 'number' &&
    Number.isFinite(record.walkSpeedPx) &&
    record.walkSpeedPx > 0
  ) {
    walkSpeedPx = record.walkSpeedPx;
  }

  const out: SpineMeta = { clips, walkSpeedPx, defaultSkin };
  if (record.autoBehavior === false) out.autoBehavior = false;
  else if (record.autoBehavior === true) out.autoBehavior = true;
  if (typeof record.skeleton === 'string' && record.skeleton.trim()) {
    out.skeleton = record.skeleton.trim();
  }
  if (typeof record.atlas === 'string' && record.atlas.trim()) {
    out.atlas = record.atlas.trim();
  }
  if (typeof record.runtime === 'string' && record.runtime.trim()) {
    out.runtime = record.runtime.trim();
  }
  return out;
}