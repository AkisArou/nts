import { sliced, slicedControl, substring, substringControlValue } from "./case.js";

export function sliceSubject(n: number): number { return sliced.length + n; }
export function sliceControl(n: number): number { return slicedControl.length + n; }
export function substringSubject(n: number): number { return substring.length + n; }
export function substringControl(n: number): number { return substringControlValue.length + n; }
