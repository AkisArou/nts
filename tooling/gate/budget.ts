/** The CPU slots the gate sizes itself to on a machine of `cores`: three quarters of them. */
export function defaultSlots(cores: number): number {
  return Math.max(1, Math.floor((cores * 3) / 4));
}

// Frontend capacity shares the CPU ceiling; memory admission is independent.
export function frontendBudget(env: NodeJS.ProcessEnv, slots: number): number {
  const value = env.NTS_GATE_FRONTENDS;
  if (value === undefined || value === "") return slots;
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) throw new Error(`NTS_GATE_FRONTENDS=${value} is not a positive number`);
  return Math.floor(count);
}
