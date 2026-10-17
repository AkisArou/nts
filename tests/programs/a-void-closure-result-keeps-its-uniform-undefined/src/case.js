// Reduced from test262 String/prototype/{slice,substring}/S15.5.4.*_A1_T14.
// The subject's function has no return; its one-change control returns
// undefined explicitly. Both conversions run at module initialization.
// Main 547 compiles both. On ee624/13e0 Wasm cannot emit the subject:
// devirtualization moves a void call into a numeric read of its erased result.
const sliced = "report".slice(function () {}());
const slicedControl = "report".slice(function () { return undefined; }());
const substring = "report".substring(function () {}());
const substringControlValue = "report".substring(function () { return undefined; }());

export function sliceSubject(n) { return sliced.length + n; }
export function sliceControl(n) { return slicedControl.length + n; }
export function substringSubject(n) { return substring.length + n; }
export function substringControl(n) { return substringControlValue.length + n; }
