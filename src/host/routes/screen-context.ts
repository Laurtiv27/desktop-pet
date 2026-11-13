/**
 * 兼容旧摘要路由：`POST /screen-context/summarize`。
 *
 * 周期摘要已取消；碎碎念改为触发时截屏并直接带图生成。本路由仅返回明确下线说明。
 * @module dsh-pet/src/host/routes/screen-context
 */
import type { RouteResult } from '../http.ts';
import { invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { PetRouteDeps, RouteInput } from './types.ts';

/**
 * 屏幕摘要领域。未命中返回 undefined。
 */
export async function handleScreenContextRoutes(
  _deps: PetRouteDeps,
  input: RouteInput,
): Promise<RouteResult | undefined> {
  if (input.rest !== 'screen-context/summarize') return undefined;
  if (input.method !== 'POST') return methodNotAllowed();
  try {
    JSON.parse(input.body ?? 'null');
  } catch {
    return invalidJson();
  }
  return okResult({
    ok: false,
    message: '独立屏幕摘要已下线；请在碎碎念触发时看屏',
  });
}
