// The oracle uses the same finite HostConfig contract as the native runtime.
// Only React itself differs: this file is linked into the pinned JavaScript
// build while ReactFiberConfigMutation.ts is materialized into the typed build.
export * from './ReactFiberConfigMutation.ts';
