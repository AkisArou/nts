// A `throw` from a method of a class declared in **another module** escapes the
// caller's `try`: nts ends with `uncaught Error: <GtkLabel> has no prop \`bogus\``
// where node catches it and answers `bad=<GtkLabel> has no prop \`bogus\``. No
// diagnostic.
//
// **The control is the same text in one file, and it is refused** -- NTS1001 "a
// call inside a `try` whose `throw` would not reach this handler: ... a raising
// copy is made of plain functions only". The two differ in where `HostNode` is
// declared and nothing else, so the refusal that exists does not see a class it
// has to cross a module boundary to reach. Found by the React lane
// (~/.cache/nts-react/probes/raise-xmod and raise-onemod), reduced here from
// their GTK host config to the part that decides: no GTK, no shim.
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
observe("ok", tried({ label: "x" }));
observe("bad", tried({ bogus: 1 }));
done();
