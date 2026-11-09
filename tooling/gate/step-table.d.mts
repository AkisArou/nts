// Types for step-table.mjs, for the TypeScript that reads the gate's step
// table; the fields are the ones its header comment defines.
export type StepRow = {
  name: string;
  slots: number;
  min?: number;
  elastic?: boolean;
  mem: number;
  fe?: boolean;
  nts?: boolean;
  needs?: readonly string[];
  after?: readonly string[];
  lock?: string;
  host?: string;
  favoured?: boolean;
  treeOnly?: boolean;
  capabilities?: readonly string[];
  bound?: number;
  doc: string;
};
export const STEPS: readonly StepRow[];
/** What the gate reserves for a step while it runs, in bytes: its row's `mem`. */
export function stepMemoryBytes(name: string): number;
/** What is wrong with the table, or null. */
export function stepTableProblem(steps?: readonly StepRow[]): string | null;
