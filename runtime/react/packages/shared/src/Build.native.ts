// The build constants of a native production build. Literal types, not
// `boolean`: the checker then knows every `if (isDevelopment)` branch is
// dead, and so does the compiler.
export const isDevelopment = false;
export const isProfiling = false;

// Each hook checks it reads back the kind of state it wrote: this build's
// erased reads are unchecked, so a changed hook order would otherwise be type
// confusion rather than a wrong answer.
export const checksHookKinds = true;
