// Only the thrown constructor differs from the study's TypeError subject.
export function errorControl(): boolean {
  try { throw new Error("x"); }
  catch (error) { return error instanceof TypeError; }
}
