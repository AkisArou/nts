// Constants fixed per build. The JavaScript build replaces
// `process.env.NODE_ENV` with a literal for each of its two builds, so every
// `if (isDevelopment)` folds away in production. A native build gives this
// module a twin with the literal written in.
export const isDevelopment: boolean = process.env.NODE_ENV !== "production";

// Profiling builds measure render durations for `<Profiler>`. Upstream turns
// them on exactly when it builds for development.
export const isProfiling: boolean = isDevelopment;
