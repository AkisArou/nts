// expect: emit-c --rc -> NTS1001 an opaque C pointer converted to a different representation is not supported by this lowering yet
//
// An object passed where a dictionary is read, as one arm of a union:
// `roundRect`'s radii is `(unrestricted double or DOMPointInit or
// sequence<...>)`, and lib.dom lets a DOMPointReadOnly stand for the
// DOMPointInit -- WebIDL reads the dictionary from the object through its
// getters, as page script's binding does. The same reading lowers where
// the dictionary is the argument itself (`transformPoint(point)`), whose
// generated binding carries the arm for it; as a union's arm the compiler
// refuses the call instead, at the radii argument. The nts:dom spelling
// of the same call is refused identically, so the binding does not offer
// that arm today: an offered overload must be callable (generate.py,
// object_arms).
//
// When the compiler carries a union arm's object overload, this fixture
// flips: the expectation becomes the emitted call, and the arm is offered
// again in the same change.
//
// Its control is `a-lib-dom-object-read-as-a-union-dictionary-arm-control`:
// the dictionary written as a literal, which compiles to the same arm.
export function probe(path: Path2D): void {
  path.roundRect(0, 0, 100, 100, new DOMPointReadOnly(20, 20));
}
