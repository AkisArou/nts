// expect: emit-c --napi -> addon-compiles
//
// FIXED, and kept as a regression guard. Value exports whose C names are the
// wrapper's own locals.
//
// `NAPI_MODULE_INIT()`'s parameter is `env`, and `process.env` is a global whose
// C name is `env`. The extern at file scope was shadowed by the parameter, so
// the wrapper read the parameter and emitted
// `nts_to_napi_entries(env, env, &value)` -- a `napi_env` where an `NtsMap *`
// belongs. `process` and `readline` both stopped building the day object and
// table value exports started publishing.
//
// The wrapper now reads every value export through a file-scope function
// defined where the global is visible, so no local it introduces can shadow
// one. This fixture names five of them at once, and would name a sixth by
// adding a line.
//
// It is the first fixture to use `addon-compiles`, because no guard above that
// one could see this: `compiles` builds `program.c`, and every other form reads
// emitted *text*. The addon here was well-formed text and uncompilable C. The
// gate's `addons` step did catch it -- twenty minutes and twenty-two modules
// later, which is the difference this form is for.
export const env: Record<string, string> = {};
export const exports = "shadowing the wrapper's own object";
export const value = 1;
export const status = 2;
export const out = 3;

export function read(key: string): string {
  return env[key] ?? "";
}
