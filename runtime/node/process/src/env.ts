// The intentionally supported part of `process.env`, from node v24.20.0
// `src/node_env_var.cc`.
//
// Node exposes a V8 exotic object whose arbitrary property reads and writes
// call getenv/setenv. NTS objects have a closed, static layout and §13 excludes
// Proxy/property interceptors, so that live property protocol cannot be
// represented honestly. The supported surface is a readonly snapshot: every
// variable present when this module loads is copied from libuv, and explicit
// runtime operations such as `loadEnvFile()` refresh newly added values.
//
// This is deliberately not a locally mutable imitation of the exotic object.
// Such an object would make `process.env.X = value` appear to work while
// `getenv()` in native code still saw the old value.

/** Read one variable. `keys` only returns names that exist. */
declare function nts_process_env(name: string): string;
/** Every name currently set, in the order the host reports them. */
declare function nts_process_env_keys(): string[];

const environment: Record<string, string | undefined> = {};

/** Refresh values currently present in the host environment. */
export function refreshEnvironment(): void {
  for (const name of nts_process_env_keys()) {
    environment[name] = nts_process_env(name);
  }
}

refreshEnvironment();

export const env: Readonly<Record<string, string | undefined>> = environment;
