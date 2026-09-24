import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { xs: readonly number[] }) {
  const total = p.xs.reduce((a, b) => a + b, 0);
  return <b>{total}</b>;
}
