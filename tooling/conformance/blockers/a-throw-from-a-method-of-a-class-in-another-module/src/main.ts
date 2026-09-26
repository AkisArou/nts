// expect: NTS1001 a call inside a `try` whose `throw` would not reach this handler: a function that itself calls something whose `throw` cannot be carried: `node.applyProps`, a method, and a raising copy is made of plain functions only
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
