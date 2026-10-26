// Pre-existing on both frontends: an exact receiver without the optional
// member still refuses the guarded call. It is not an execution control.
interface OptionalFinisher {
  readonly marker: number;
  finish?(value?: number): number;
}
class Finisher implements OptionalFinisher {
  readonly marker = 1;
  finish(value?: number): number { return value === undefined ? 7 : value + 1; }
}
class InheritedFinisher extends Finisher {}
class OverriddenFinisher extends Finisher {
  override finish(value?: number): number { return super.finish(value) * 2; }
}
function omitValue(finisher: OptionalFinisher): number {
  return finisher.finish === undefined ? -1 : finisher.finish();
}
function passValue(finisher: OptionalFinisher, n: number): number {
  return finisher.finish === undefined ? -1 : finisher.finish(n);
}
class MissingFinisher implements OptionalFinisher {
  readonly marker = 1;
}
export function missingMember(n: number): number {
  const finisher = new MissingFinisher();
  return omitValue(finisher) + passValue(finisher, n);
}
