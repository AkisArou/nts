class Base {
  invoke(n: number): number { return this.value(n); }
  value(n: number): number { return n + 1; }
}
class Refused extends Base {
  override value(n: number): number { return n + eval("7"); }
}
class Inherited extends Refused {}
class Grandchild extends Refused {
  override value(n: number): number { return n + 7; }
}
class Compiled extends Base {
  override value(n: number): number { return n + 7; }
  unused(n: number): number { return n + eval("9"); }
}
abstract class Abstract {
  abstract value(n: number): number;
  invoke(n: number): number { return this.value(n); }
}
class Concrete extends Abstract {
  value(n: number): number { return n + 3; }
}
interface Face { value(n: number): number; }
class Supplier implements Face {
  value(n: number): number { return n + 5; }
}
function throughFace(receiver: Face, n: number): number {
  return receiver.value(n);
}
function refusedDirect(n: number): number { return n + eval("11"); }

function subject(n: number): number {
  const receiver: Base = new Refused();
  return receiver.invoke(n);
}
function inherited(n: number): number {
  const receiver: Base = new Inherited();
  return receiver.invoke(n);
}
function mixed(n: number): number {
  const receiver: Base = n > 0 ? new Refused() : new Compiled();
  return receiver.invoke(n);
}
function control(n: number): number {
  const receiver: Base = new Compiled();
  return receiver.invoke(n);
}
function grandchild(n: number): number {
  const receiver: Base = new Grandchild();
  return receiver.invoke(n);
}
function abstractControl(n: number): number {
  const receiver: Abstract = new Concrete();
  return receiver.invoke(n);
}
function interfaceControl(n: number): number {
  return throughFace(new Supplier(), n);
}
function direct(n: number): number { return refusedDirect(n); }


// Three deliberately stopped inputs, below the differential's restart cap.
// Every other input exercises compiled dispatch, including a good override
// below the refused parent. Counting all 116 cases prevents a refusal from
// cutting the run short and hiding the controls.
export function oneRefused(n: number): number {
  return n === 1 ? subject(n) : control(n);
}
export function oneInherited(n: number): number {
  return n === 1 ? inherited(n) : grandchild(n);
}
export function oneMixed(n: number): number {
  return n === 1 ? mixed(1) : mixed(-1);
}
export function validDispatch(n: number): number {
  return control(n) + grandchild(n) + abstractControl(n) + interfaceControl(n);
}
