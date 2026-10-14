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
//
// # `({ x = 1 } = o)`, which is the same node and one more child
//
// Six files of the census slice moved from the refusal above to *"a shorthand
// property of unexpected shape"* the moment the one-child form started
// working --- the next blocker, visible only because the first was gone. It is
// the same name resolved the same way, plus a default standing in where the
// read is `undefined`, and the default half is `bind_pattern`'s two lines asked
// of the same helpers: one question about one node, not two.
//
// **The encoder keeps the `=`.** The children are
// `[identifier, EqualsToken, initializer]` and not `[name, default]` --- a
// probe said so after the two-child spelling compiled, ran, and refused every
// one of these exactly as before. A pattern match that never matches and a
// guard that never fires fail the same silent way.

let withDefault = 0;
({ withDefault = 7 } = {} as { withDefault?: number });

let defaultSkipped = 0;
({ defaultSkipped = 7 } = { defaultSkipped: 3 });

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

export function aDefaultStandsInForAnAbsentProperty(n: number): number {
  return withDefault * 10 + n;
}

export function aPresentPropertyWinsOverTheDefault(n: number): number {
  return defaultSkipped * 10 + n;
}

/// The default is an *expression*, and it must not run when the property is
/// there. Counting the calls is the only arm that can tell.
export function theDefaultIsNotEvaluatedWhenPresent(): number {
  let calls = 0;
  const fallback = (): number => {
    calls += 1;
    return 4;
  };
  let taken = 0;
  ({ taken = fallback() } = { taken: 9 });
  let given = 0;
  ({ given = fallback() } = {} as { given?: number });
  return calls * 100 + taken * 10 + given;
}

export function severalDefaultsAtOnce(n: number): number {
  let a = 0;
  let b = 0;
  ({ a = 1, b = 2 } = {} as { a?: number; b?: number });
  return a * 100 + b * 10 + n;
}
