// **This was `blockers/a-throw-from-a-method-of-a-class-in-another-module`, and before that a silent escape.**
// A method now has a raising copy: `callee_for` makes a call on a member no
// subclass overrides a `Callee::Direct` by name, so the copy is reached by
// naming it and no dispatch slot is needed. The refusal this file pinned --
// "a method, and a raising copy is made of plain functions only" -- is gone, so
// what it records is a program that agrees with node.
//
// What still refuses is one case over: an **overridden** method, whose call is a
// `Callee::Virtual` through a slot, and a raising copy is reached by name.
// `examples/a-throw-that-stays-in-its-function` carries that arm.
//
// **This refusal replaced a silent escape.** A `throw` from a method of a class
// declared in *another module* left the caller's `try` with no handler edge at all:
// nts ended with `uncaught Error: <GtkLabel> has no prop \`bogus\`` where node
// catches it. The same text in one file was already refused. The cause was in the
// frontend: a symbol first interned from the importing file lost its declaration
// handle, so the method's `throw` was never seen and the call "could not raise".
//
// This is the real-world chain, the React lane's host config (their probes
// raise-xmod / raise-onemod) reduced to pure TS; the expectation is the cascade's
// leaf, `node.applyProps`. `a-cross-module-throw-a-nullable-parameter-hides` is the
// minimal reduction, with a local class and an imported plain function as controls.
// Held as a wrong answer in tooling/conformance/outcomes/ until the refusal landed.
import { HostNode, type Props } from "./HostNode.ts";
class LabelNode extends HostNode {
  constructor() {
    super("GtkLabel");
  }
  setProp(key: string, _value: unknown): boolean {
    return key === "label";
  }
}
function create(props: Props): HostNode {
  const node: HostNode = new LabelNode();
  node.applyProps(null, props);
  return node;
}
function tried(props: Props): string {
  try {
    create(props);
  } catch (error) {
    return error instanceof Error ? error.message : "a non-error";
  }
  return "none";
}
export const ok = tried({ label: "x" });
export const bad = tried({ bogus: 1 });

/**
 * The same two arms as a function the differential can call, because a
 * module-scope `const` has no scalar signature and `nts check` compares nothing
 * without one -- which would make this example "compared nothing" and assert
 * exactly as much as the blockers file it replaced did about the answer.
 *
 * `0` is the caught cross-module throw and `1` the arm that does not throw.
 */
export function caught(n: number): string {
  return (n & 1) === 0 ? tried({ bogus: 1 }) : tried({ label: "x" });
}
