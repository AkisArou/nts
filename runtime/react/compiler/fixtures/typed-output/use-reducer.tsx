import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
type Act = { type: "inc" } | { type: "add"; by: number };
function reduce(s: number, a: Act): number { return a.type === "inc" ? s + 1 : s + a.by; }
export function C(p: { by: number }) {
  const [n, dispatch] = useReducer(reduce, 0);
  const add = () => dispatch({ type: "add", by: p.by });
  return <b onClick={add}>{n}</b>;
}
