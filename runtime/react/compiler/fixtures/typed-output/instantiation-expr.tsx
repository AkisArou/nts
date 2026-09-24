import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function id<T>(x: T): T { return x; }
export function C(p: { s: string }) {
  const f = id<string>;
  const v = f(p.s);
  return <b>{v}</b>;
}
