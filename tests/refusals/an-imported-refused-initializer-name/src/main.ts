// expect: the initializer of `sha2561` was not compiled because it calls `refusedInitializer`
// Manufactured regex refusal: compiler lane must print the source binding, preserving genuine digits.
import "./state.ts";
export function kept(n: number): number { return n + 1; }
