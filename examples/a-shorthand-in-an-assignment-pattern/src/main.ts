// `({ x } = p)` --- one identifier standing for both the property read and the
// variable written --- which was refused as *"a shorthand in an assignment
// pattern, whose name resolves to the property"*.
//
// The refusal was right about the hazard and wrong about the remedy being
// unavailable. The symbol the checker puts on that node **is** the property's,
// so writing through it stores somewhere nothing reads and `x` silently keeps
// its old value. That is the failure worth refusing over.
//
// But the object *literal* path has resolved the same node for as long as it
// has existed, with `shorthand_value_symbol`: match the name against what a
// name can denote, in the order a scope chain would --- a local first, because
// a local shadows --- and **refuse outright when two bindings of that name are
// in scope**, rather than picking one and compiling. The assignment path asks
// the same question, so it asks the same function.
//
// `place_of`'s tail became `place_for_symbol` for this: one derivation of
// "where does this name write", reached with the node's own symbol from
// `place_of` and with the resolved one from here. Two copies would have been
// the kind that drift.
//
// # The arms that are not just a value
//
// `aLocalShadowsTheModuleBinding` pins the order the lookup uses: the local
// wins and the module-scope `outer` is left alone, which is the case a lookup
// by name gets wrong if it searches module scope first.
//
// `writesThroughToTheGlobal` pins the other half --- a module-scope name is a
// *store*, not a rebinding, so the write has to reach the global rather than
// create a binding that shadows it for the rest of the function.
//
// Two locals of one name in scope is refused, and stays refused:
// `blockers/a-shorthand-naming-a-shadowed-binding` holds it.

let outer = 0;

let counted = 0;
({ counted } = { counted: 6 });

export function aPlainShorthand(n: number): number {
  let x = 0;
  ({ x } = { x: 5 });
  return x * 10 + n;
}

export function severalAtOnce(n: number): number {
  let a = 0;
  let b = 0;
  ({ a, b } = { a: 1, b: 2 });
  return a * 100 + b * 10 + n;
}

export function mixedWithAnExplicitOne(n: number): number {
  let x = 0;
  let y = 0;
  ({ x, y: y } = { x: 1, y: 2 });
  return x * 100 + y * 10 + n;
}

export function aLocalShadowsTheModuleBinding(n: number): number {
  let outer = 1;
  ({ outer } = { outer: 5 });
  return outer * 10 + n;
}

export function theModuleBindingWasNotTouched(): number {
  return outer;
}

export function writesThroughToTheGlobal(): number {
  return counted;
}

export function insideALoop(n: number): number {
  let sum = 0;
  for (const src of [{ v: 1 }, { v: 2 }]) {
    let v = 0;
    ({ v } = src);
    sum += v;
  }
  return sum * 10 + n;
}
