// expect: emit-c --napi -> NTS2006 an object type with no layout
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
