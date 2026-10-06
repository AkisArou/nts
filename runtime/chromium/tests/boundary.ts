// The C boundary itself, before any DOM: a scalar, a managed string in and
// out, an explicitly created counter the C shim owns, and scalar suspension.
// Chromium calls these with values its renderer integration supplies; no
// module globals, host API, or private IR.
export function ntsChromiumProbe(input: number): number {
  return input * input + 1;
}

// A managed input and owned result exercise the C boundary and reclamation.
export function ntsChromiumText(input: string): string {
  return "native:" + input;
}

// Explicit document state: creating an environment does not instantiate
// compiled module globals. The C shim owns this returned managed reference.
export interface ChromiumCounterState {
  count: number;
}

export function ntsChromiumCreateCounter(): ChromiumCounterState {
  return { count: 0 };
}

export function ntsChromiumIncrementCounter(state: ChromiumCounterState): number {
  state.count += 1;
  return state.count;
}

export function ntsChromiumCounterValue(state: ChromiumCounterState): number {
  return state.count;
}

// Scalar suspension isolates scheduling from the available compiler's
// managed-argument capture bug. The C completion invokes the compiled
// increment on its explicitly owned document counter after these awaits.
export async function ntsChromiumAwaitCounter(count: number): Promise<number> {
  await Promise.resolve(0);
  await Promise.resolve(0);
  return count + 1;
}
