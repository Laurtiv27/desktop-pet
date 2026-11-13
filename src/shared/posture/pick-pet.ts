/**
 * 从 GET /config 的结果里挑当前桌面宠物，并收集该宠物的动画名池。
 *
 * 口径与 posture-guard `pet_bridge.pick_active_pet` / `pool_for` 一致：
 * display 为 desktop 或 both 才算可见；可见列表里自定义 id 优先于 `main`；
 * 一个都不可见时回 fallback。主进程 CJS 不能 import 本文件，`posture-window.js` 里有同算法副本。
 * @module dsh-pet/src/shared/posture/pick-pet
 */

/** /config 读不到时的兜底：内置默认蓝毛小女仆。 */
export const DEFAULT_PET_ID = 'main';

type PetEntry = {
  pets?: unknown;
  animations?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 挑当前应联动的宠物 id。
 *
 * @param cfg - GET /config 的 JSON；不是对象时直接回 fallback。
 * @param fallback - 没有桌面可见宠物时的 id，缺省 `main`。
 * @returns 选中的宠物 id。
 */
export function pickActivePet(cfg: unknown, fallback: string = DEFAULT_PET_ID): string {
  if (!isRecord(cfg)) return fallback;
  const visible: string[] = [];
  for (const entry of Object.values(cfg)) {
    if (!isRecord(entry) || !Array.isArray(entry.pets)) continue;
    for (const pet of entry.pets) {
      if (!isRecord(pet)) continue;
      const id = pet.id;
      const display = pet.display;
      if (
        (typeof id === 'string' || typeof id === 'number') &&
        id !== '' &&
        (display === 'desktop' || display === 'both')
      ) {
        visible.push(String(id));
      }
    }
  }
  if (visible.length === 0) return fallback;
  for (const petId of visible) {
    if (petId !== DEFAULT_PET_ID) return petId;
  }
  return visible[0] ?? fallback;
}

function addName(names: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  if (value === '') return;
  const text = String(value);
  if (seen.has(text)) return;
  seen.add(text);
  names.push(text);
}

/**
 * 收集某只宠物所属条目的动画名（保序去重）。
 *
 * 来源：idle/turn/drag/clicks、moves.actions、categories.actions、events 的字符串与一层嵌套列表。
 * 找不到该宠物、动画段不是对象、或池为空时返回 null（调用方不做池校验）。
 *
 * @param cfg - GET /config 的 JSON。
 * @param petId - 要收集的宠物 id，与配置里的 id 全等比较。
 * @returns 动画名列表；无法校验时为 null。
 */
export function animationPoolFor(cfg: unknown, petId: string): string[] | null {
  if (!isRecord(cfg)) return null;
  for (const entryValue of Object.values(cfg)) {
    const entry = entryValue as PetEntry;
    if (!isRecord(entry)) continue;
    const pets = Array.isArray(entry.pets) ? entry.pets : [];
    const owns = pets.some((pet) => isRecord(pet) && pet.id === petId);
    if (!owns) continue;
    const animations = entry.animations;
    if (!isRecord(animations)) continue;

    const names: string[] = [];
    const seen = new Set<string>();
    for (const key of ['idle', 'turn', 'drag', 'clicks'] as const) {
      const list = animations[key];
      if (Array.isArray(list)) {
        for (const item of list) addName(names, seen, item);
      }
    }
    const moves = animations.moves;
    const actions = isRecord(moves) && Array.isArray(moves.actions) ? moves.actions : [];
    for (const item of actions) {
      if (isRecord(item)) addName(names, seen, item.name);
      else addName(names, seen, item);
    }
    const categories = Array.isArray(animations.categories) ? animations.categories : [];
    for (const category of categories) {
      if (!isRecord(category) || !Array.isArray(category.actions)) continue;
      for (const item of category.actions) addName(names, seen, item);
    }
    const events = animations.events;
    if (isRecord(events)) {
      for (const value of Object.values(events)) {
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (Array.isArray(item)) {
            for (const nested of item) addName(names, seen, nested);
          } else {
            addName(names, seen, item);
          }
        }
      }
    }
    return names.length > 0 ? names : null;
  }
  return null;
}
