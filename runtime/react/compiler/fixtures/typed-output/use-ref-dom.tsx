import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const focus = () => ref.current?.focus();
  return <div ref={ref} onClick={focus}>{p.n}</div>;
}
