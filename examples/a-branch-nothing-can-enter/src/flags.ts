// A `const` bound to a literal, which TypeScript types as `false` -- so the
// folding is the checker's and the lowering only reads it. Across a module
// boundary, because that is where React's build puts it.
export const isDevelopment = false;

/**
 * Widened by its own annotation, so the checker says `boolean` and this is
 * **not** decidable. Here on purpose: the fixture asserts that the fold reads
 * the checker rather than the initialiser.
 */
export const isDevelopmentWide: boolean = false;
