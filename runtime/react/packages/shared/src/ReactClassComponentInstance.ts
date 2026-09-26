// What the reconciler reads and writes on a class component's instance, at
// fixed places whatever the class: the native `Component<P, S>` extends this
// and redeclares `props` and `state` with their types, so the reconciler
// holds every instance by one non-generic class (CLASS-COMPONENTS.md). The
// JavaScript build's instances are upstream's objects, which carry the same
// names.

export class ClassComponentInstance {
  props: unknown;
  context: unknown;
  refs: unknown;
  updater: unknown;
  state: unknown = null;
  // Written by the reconciler: the instance's fiber, and the snapshot
  // getSnapshotBeforeUpdate returned, held until componentDidUpdate
  // receives it.
  _reactInternals: unknown = undefined;
  __reactInternalSnapshotBeforeUpdate: unknown = undefined;

  constructor(props: unknown, context: unknown, updater: unknown) {
    this.props = props;
    this.context = context;
    this.refs = {};
    this.updater = updater;
  }
}
