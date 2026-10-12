interface OptionalSlot { readonly value?: number; }
interface ExplicitSlot { readonly value: number | undefined; }

class StoredSlot { value: number | undefined = undefined; }

export function readOptional(slot: OptionalSlot): number {
  return slot.value ?? -1;
}
export function readExplicit(slot: ExplicitSlot): number {
  return slot.value ?? -2;
}
export function makeSlot(n: number): ExplicitSlot {
  const slot = new StoredSlot();
  slot.value = n;
  return slot;
}
