// Frontend capacity shares the CPU ceiling; memory admission is independent.
export function frontendBudget(env: NodeJS.ProcessEnv, slots: number): number {
  const value = env.NTS_GATE_FRONTENDS;
  if (value === undefined || value === "") return slots;
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) throw new Error(`NTS_GATE_FRONTENDS=${value} is not a positive number`);
  return Math.floor(count);
}
