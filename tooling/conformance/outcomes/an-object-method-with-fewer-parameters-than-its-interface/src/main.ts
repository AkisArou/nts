// **Invalid HIR**: an object-literal method declared with fewer parameters than
// the interface it implements, called through the interface. JavaScript drops the
// extra arguments; nts's verifier refuses to emit. Declaring all three parameters
// (`enqueue(instance, _state, _name)`) is the control, and emits. It is React's
// `classComponentUpdater`. Found by the React lane
// (~/.cache/nts-react/probes/fewer-params).
interface Updater {
  enqueue(instance: object, state: unknown, name: string): string;
}
const noop: Updater = {
  enqueue(instance) {
    return "noop " + String(instance !== null);
  },
};
class Holder {
  updater: Updater = noop;
  go(): string {
    return this.updater.enqueue(this, 1, "setState");
  }
}
observe("answer", new Holder().go());
done();
