/** 提醒演出：短锁 → 气泡 → 点播动画 → 放锁。任一步失败则尝试 release 并返回 false，不向外抛错。 */

export const REMINDER_BROADCAST_MS = 4500;
const LOCK_TTL_MS = 8000;

export type PetRouteClient = {
  /** rest 不含前缀，如 'lock' | 'anim' | 'broadcast' | 'lock/release' | 'sleep' | 'wake' */
  request(
    method: 'GET' | 'POST',
    rest: string,
    query: Record<string, string>,
    body?: unknown,
  ): Promise<{ ok: boolean; json?: unknown }>;
};

async function tryRelease(
  client: PetRouteClient,
  query: Record<string, string>,
  lockId: string,
): Promise<void> {
  try {
    await client.request('POST', 'lock/release', query, { lockId });
  } catch {
    // 忽略 release 失败
  }
}

export async function performReminder(
  client: PetRouteClient,
  opts: { petId: string; animName: string; message: string; durationMs?: number },
): Promise<boolean> {
  const { petId, animName, message, durationMs = REMINDER_BROADCAST_MS } = opts;
  const baseQuery = { pet: petId, surface: 'any' };
  let lockId: string | undefined;

  try {
    const lockRes = await client.request('POST', 'lock', baseQuery, { ttl: LOCK_TTL_MS });
    if (!lockRes.ok) return false;
    const id = lockRes.json && typeof lockRes.json === 'object' ? (lockRes.json as { lockId?: unknown }).lockId : undefined;
    if (typeof id !== 'string' || !id) return false;
    lockId = id;

    const lockedQuery = { ...baseQuery, lock: lockId };

    const bcastRes = await client.request('POST', 'broadcast', lockedQuery, {
      text: message,
      duration: durationMs,
      anim: false,
    });
    if (!bcastRes.ok) {
      await tryRelease(client, baseQuery, lockId);
      return false;
    }

    const animRes = await client.request('POST', 'anim', lockedQuery, { name: animName });
    if (!animRes.ok) {
      await tryRelease(client, baseQuery, lockId);
      return false;
    }

    const relRes = await client.request('POST', 'lock/release', baseQuery, { lockId });
    return relRes.ok;
  } catch {
    if (lockId) await tryRelease(client, baseQuery, lockId);
    return false;
  }
}
