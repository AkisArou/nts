import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  const make = (): Item => ({ id: p.n, name: "x" });
  const it = make();
  return <b>{it.name}</b>;
}
