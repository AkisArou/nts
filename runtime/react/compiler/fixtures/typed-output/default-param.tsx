import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  const f = (a: number = 1) => a + p.n;
  return <b>{f()}</b>;
}
