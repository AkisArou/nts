import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  type Pair = [number, number];
  const pair: Pair = [p.n, p.n + 1];
  return <b>{pair[0]}</b>;
}
