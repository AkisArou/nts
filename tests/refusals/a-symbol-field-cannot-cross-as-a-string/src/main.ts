// expect: emit-c --napi -> no wrapper for returnsSymbolKey: returns a plain object with a symbol-keyed field, which has no Node-API projection
// control: exports.returnsStringKey().iterator === 7
//
// A symbol property must keep its identity across a JavaScript boundary.
// The control differs only in whether the property key is a string or a symbol.
export function returnsStringKey() { return { iterator: 7 }; }
export function returnsSymbolKey() { return { [Symbol.iterator]: 7 }; }
