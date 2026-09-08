// expect: emit-c --napi -> emits-addon nts_to_napi_view(env, result, &out)
//
// A typed array returned from an exported function reaches the host.
//
// It did not, and nothing did: across all 70 emitted addons in the tree there
// were **zero** calls to `napi_create_typedarray`, `napi_create_buffer`,
// `napi_create_arraybuffer`, `napi_create_external_arraybuffer` and
// `napi_create_dataview`. The wrapper could build strings, functions, errors,
// doubles, plain arrays and one object, and no view of any width at all.
//
// That is 66 signatures across nine of node's modules -- `stream` 20,
// `buffer` 18, `fs` 10, `zlib` 9 -- so it is a boundary primitive rather than
// any one module's problem.
//
// It crosses as a **copy**, which is what lets it cross now while `ArrayBuffer`
// is still refused: the lifetime question is about a *shared* block, and a copy
// shares nothing. The companion fixture holds the other half of that trade.

export function marker(): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = 0xe1;
  return out;
}
