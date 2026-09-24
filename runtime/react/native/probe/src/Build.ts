// The build constants of a native production build. Literal types, not
// `boolean`: the checker then knows every `if (isDevelopment)` branch is
// dead, and so does the compiler.
export const isDevelopment = false;
export const isProfiling = false;
