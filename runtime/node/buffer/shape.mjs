// The object node's tests see as `require('buffer')`.
//
// Node's module exports `Buffer` alongside `kMaxLength`, `constants`, `atob`,
// `btoa` and the rest; the class itself is one property, not the module.
export function shape(exports) {
  const mod = { ...exports };
  delete mod.default;
  return mod;
}
