/*---
description: Required<T> and a `-readonly` mapping type values whose optional members were filled and whose readonly ones are written.
features: [ts-type-operators, ts-mapped-types, ts-utility-types, ts-readonly, ts-optional-properties]
---*/
type Options = { readonly retries?: number; readonly verbose?: boolean };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function complete(options: Options): Required<Options> {
  return { retries: options.retries ?? 3, verbose: options.verbose ?? false };
}
const full = complete({ verbose: true });
const editable: Mutable<Required<Options>> = { ...full };
editable.retries = 5;
assert.sameValue(full.retries, 3);
assert.sameValue(editable.retries, 5);
assert.sameValue(editable.verbose, true);
