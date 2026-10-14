import { flags } from "./flags.ts";

// Reached only through `ordering`'s `import()`.
flags.lateRan = true;

export const loaded = true;
