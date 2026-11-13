export type AnimMap = {
  default: Record<string, string>;
  by_pet: Record<string, Record<string, string>>;
};

export function resolveAnim(map: AnimMap, petId: string, eventType: string): string | undefined {
  const petTable = map.by_pet[petId];
  const fromPet = petTable?.[eventType];
  if (typeof fromPet === 'string') return fromPet;
  const fromDefault = map.default[eventType];
  return typeof fromDefault === 'string' ? fromDefault : undefined;
}

export function resolveAnimWithFallback(
  map: AnimMap,
  petId: string,
  eventType: string,
  pool: string[] | null,
): string | undefined {
  const name = resolveAnim(map, petId, eventType);
  if (name === undefined) return undefined;
  if (!pool || pool.length === 0) return name;
  if (pool.includes(name)) return name;
  return pool[0];
}
