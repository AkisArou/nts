// A **wrong answer**: a static read through a constructor value (`ctor: typeof
// Base`, `ctor.contextType`) returns the *base's* static, not the subclass's. node
// answers `context theme,none derived 4,-1`; nts `context none,none derived -1,-1`.
// It is how React reads `contextType` and `getDerivedStateFromProps` off a class
// component. Found by the React lane (~/.cache/nts-react/probes/classvalues-run),
// ported from its GTK shim to observe/done.
abstract class Base {
  static contextType?: string;
  static getDerivedStateFromProps?: (props: number) => number;
}
class A extends Base {
  static contextType = "theme";
  static getDerivedStateFromProps = (props: number): number => props + 1;
}
class B extends Base {}

function context(ctor: typeof Base): string {
  return ctor.contextType ?? "none";
}
function derived(ctor: typeof Base, props: number): number {
  const gdsfp = ctor.getDerivedStateFromProps;
  return gdsfp === undefined ? -1 : gdsfp(props);
}
observe("context", context(A) + "," + context(B));
observe("derived", String(derived(A, 3)) + "," + String(derived(B, 3)));
done();
