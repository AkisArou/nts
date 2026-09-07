// expect: emit-c --napi -> emits-addon napi_create_function(env, "decode", NAPI_AUTO_LENGTH, nts_napi_parse
//
// Two exports of the *same* function become two different JavaScript function
// objects. Both names publish, every call through either works, and
// `decode === parse` is false.
//
// The wrapper builds one `napi_create_function` per exported name:
//
//     napi_create_function(env, "decode", ..., nts_napi_parse, ...)
//     napi_create_function(env, "parse",  ..., nts_napi_parse, ...)
//
// Same implementation, two objects. On node these are one object --
// `lib/querystring.js` writes `decode: parse` in an object literal, and
// `querystring.decode === querystring.parse` is true. `runtime/node/querystring/
// test/alias-identity-static.js` asserts it and passes on the interpreted lane;
// this is the compiled lane failing it, and the two were written on the same day
// from opposite ends.
//
// It is worth having as a blocker rather than as a note because it is invisible
// from every angle a pass count can see. Nothing refuses, `emit-c` succeeds and
// reports no missing wrapper, both names appear in the export table, and an
// export-surface diff against node's finds nothing absent. The only thing that
// disagrees is an identity comparison, and node's own tests contain none --
// searched every `parallel/test-querystring*.js`.
//
// Also the reason this fixture reads `addon.c` rather than stdout: the defect is
// not something the compiler *says*, it is something the wrapper *builds*.
//
// The fix is not to publish one name and alias the other in the shape layer,
// which would move the problem to a file that cannot see it. It is for the
// wrapper to create the function once per implementation and bind both names to
// that one value, the way the object literal it is modelling does.
export function parse(input: string): string {
  return input;
}

export const decode = parse;
