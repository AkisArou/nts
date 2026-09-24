import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  const sum = (...xs: number[]) => xs.reduce((a, b) => a + b, p.n);
  return <b>{sum(1, 2)}</b>;
}
