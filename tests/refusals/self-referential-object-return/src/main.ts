// expect: emit-c --napi -> lacks-addon nts_to_napi_obj_Loop
//
// The control for `nested-object-return`, and the reason its recursion
// terminates for a stated reason rather than by luck.
//
// `object_crosses` walks object fields to decide whether a layout can be copied
// out, and a layout that reaches itself has no finite JavaScript object to build
// and no terminating helper to emit. It is refused by the *chain* -- the
// layouts currently being walked -- and not by a visited set, because a layout
// reached twice down two different fields is fine and has to keep crossing.
//
// Without this fixture the cycle guard is a line of code nobody has seen do
// anything. With it, deleting the guard hangs the compiler on this input rather
// than passing the suite.
interface Loop {
  depth: number;
  next: Loop;
}

export function build(n: number): Loop {
  const one: Loop = { depth: n } as Loop;
  one.next = one;
  return one;
}
