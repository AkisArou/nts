import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  interface Box { v: number }
  const box: Box = { v: p.n };
  const f = (b: Box) => b.v * 2;
  return <b>{f(box)}</b>;
}
