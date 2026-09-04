// The object node's tests see as `require('url')`.
//
// Node's module carries both APIs plus the two WHATWG classes, and `Url` is a
// constructor rather than a namespace. `URL` and `URLSearchParams` are also
// globals; unlike `Buffer`, nothing inside node consumes them on our behalf,
// so substituting them is safe and is what the WHATWG tests measure.
export function shape(exports) {
  const url = { ...exports };
  delete url.default;
  return url;
}

export function installGlobals(underTest) {
  globalThis.URL = underTest.URL;
  globalThis.URLSearchParams = underTest.URLSearchParams;
}
