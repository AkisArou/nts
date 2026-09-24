import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { xs: number[] }) {
  type N = number;
  const doubled = p.xs.map((x: N) => x * 2);
  return <b>{doubled.join()}</b>;
}
