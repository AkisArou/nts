type Budget = { slots: number; mem: number; fe: number };
type Step = { slots: number; min?: number; mem: number; fe?: boolean };

// Elastic grants can return resources; a fixed grant only ends with its step.
// Withholding cannot help a candidate that exceeds the remaining fixed floor.
export function fixedReservation(step: Step, fixed: Budget, budget: Budget): number {
  const least = Math.min(step.min ?? Math.max(1, Math.ceil(step.slots / 2)), step.slots, budget.slots);
  if (fixed.slots + least > budget.slots || fixed.mem + step.mem > budget.mem
      || fixed.fe + (step.fe ? least : 0) > budget.fe) return 0;
  return least;
}
