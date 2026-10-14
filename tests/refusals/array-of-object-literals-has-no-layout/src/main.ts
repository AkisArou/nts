// expect: emits-addon nts_to_napi_array_of_Row
//
// **Kept as a guard. Fixed 2026-09-10, and the fix was one line asking a
// question nobody had asked.**
//
// The type was layable-out the whole time. A field of array type forces its
// element's layout; a *returned* array did not, so `[{ name: "r", size: 1 }]`
// typed `Row[]` reached the C emitter with no layout for its element and
// stopped there -- `NTS2006`, raised by the backend, one step past every message
// that names a source line. `lower_array_literal` asks for it now.
//
// Built and run rather than read off the emitted text:
//
//     one()   {"name":"r","size":1}
//     many()  [{"name":"r","size":1},{"name":"s","size":2}]
//
// which is node's answer for both.
//
// **Found by accident**, and the accident is worth recording. A predicate added
// to `coerce` for an unrelated check happened to call `layout_of` on the element
// type, and this fixture went green with nothing aimed at it. That is the second
// query-with-a-side-effect in one night and the first that changed a program for
// the better -- the other emitted `incompatible pointer types` in six modules.
// A fix that arrives that way is not a fix until it is made deliberate, because
// it depends on a coercion that may not happen.
//
// The filing below is kept: what it argued about the wrapper being done and
// inert is what made the one-line fix obviously sufficient.
//
// An array *literal* of object literals has an element type the lowering gives
// no layout, so `[{ name: "r", size: 1 }]` refuses where the same object on its
// own does not.
//
// `one()` is the control and it is the point: a `Row` return crosses the
// boundary today and answers `{ name: 'r', size: 1 }` from node. So this is not
// "objects do not cross" and it is not the wrapper -- the wrapper builds an
// array of objects now, and would build this one.
//
// **The refusal moved and that is the finding.** `object[]` used to fail at the
// boundary with `returns an object[]`, because `Cross::Numbers` meant `number[]`
// was the only array that could return at all. That generalised: an array
// crosses when its element does, and `Row` is an element that crosses. What is
// left underneath is a *lowering* question -- an anonymous element type with no
// layout -- and it was hidden behind the wrapper's refusal until the wrapper
// stopped refusing.
//
// So the wrapper half is done and inert: `nts_to_napi_obj_Row` and
// `nts_to_napi_array_of_Row` are both emitted for the control, and the second
// has nothing to call it until this is fixed. That is worth stating plainly
// rather than claiming `Dirent[]` and `Listener[]` -- 15 of the Node lane's 71
// by element -- which is what this would unblock and does not yet.

interface Row {
  name: string;
  size: number;
}

// The control: an object return, which crosses.
export function one(): Row {
  return { name: "r", size: 1 };
}

// The subject: an array of them.
export function many(): Row[] {
  return [
    { name: "r", size: 1 },
    { name: "s", size: 2 },
  ];
}
