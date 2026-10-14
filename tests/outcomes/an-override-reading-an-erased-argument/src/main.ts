// An **abort**, with no refusal: a subclass overrides `update(_prev: unknown)` from a
// non-generic base with `update(prev: Counter)` and reads `prev.n`, and is called
// through the base with the argument erased. node answers `user 1 | base`; nts
// dies with SIGSEGV. The control -- the override reading `this.props.n` instead of
// `prev.n` -- agrees with node. It is the React reconciler's shape: an erased
// instance base under the public generic `Component<P>`. Found by the React lane
// (~/.cache/nts-react/probes/override-erased), ported from its GTK shim to
// observe/done.
//
// **Refused by name since b09c3e6f6**, which hoisted the JVM's NTS4009 check
// into lowering for this shape: it was SIGSEGV on C until then. The record is
// the refusal; the arms that must stay silent beside it are
// an-override-declaring-fewer-parameters, the two covariant-record fixtures
// that keep the base's fields in order, and a-controller-stored-by-a-generic-branch.
class InstanceBase {
  props: unknown;
  constructor(props: unknown) {
    this.props = props;
  }
  update(_prev: unknown): string {
    return "base";
  }
}
class Component<P> extends InstanceBase {
  declare props: P;
}
type Counter = { n: number };
class User extends Component<Counter> {
  update(prev: Counter): string {
    return "user " + String(prev.n);
  }
}
class Quiet extends Component<Counter> {}

function call(instance: InstanceBase, prev: unknown): string {
  return instance.update(prev);
}
const user: InstanceBase = new User({ n: 2 });
const quiet: InstanceBase = new Quiet({ n: 3 });
observe("calls", call(user, { n: 1 }) + " | " + call(quiet, { n: 1 }));
done();
