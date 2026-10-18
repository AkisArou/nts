import { subject, inherited, mixed, control, grandchild, abstractControl, interfaceControl } from "./main.ts";

// Three deliberately stopped inputs, below the differential's restart cap.
// Every other input exercises compiled dispatch, including a good override
// below the refused parent. Counting all 116 cases prevents a refusal from
// cutting the run short and hiding the controls.
export function oneRefused(n: number): number {
  return n === 0 ? subject(n) : control(n);
}
export function oneInherited(n: number): number {
  return n === 0 ? inherited(n) : grandchild(n);
}
export function oneMixed(n: number): number {
  return n === 0 ? mixed(1) : mixed(-1);
}
export function validDispatch(n: number): number {
  return control(n) + grandchild(n) + abstractControl(n) + interfaceControl(n);
}
