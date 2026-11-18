/**
 * `pets[].spine` 的形状校验。
 *
 * 保存与合并共用这一份：`root` 必填，`meta` 交给 parseSpineMeta。
 * 不读磁盘上的 meta.json（播放端目前只消费配置里的 meta）。
 * @module dsh-pet/src/host/config/spine-field
 */
import { parseSpineMeta, type SpineMeta } from '../../shared/behavior/spine-meta.ts';

export type PetSpine = { root: string; meta?: SpineMeta };

/**
 * 解析一只宠物的 spine。
 *
 * `undefined` / `null` = 请求没写，调用方保留已有值。
 * 非法返回 `null`（保存整包拒绝；合并告警后回落）。
 */
export function parsePetSpine(raw: unknown): PetSpine | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.root !== 'string') return null;
  const root = record.root.trim();
  if (!root || root.includes('..')) return null;
  if (record.meta === undefined || record.meta === null) return { root };
  const meta = parseSpineMeta(record.meta);
  if (!meta) return null;
  return { root, meta };
}
