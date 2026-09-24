import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
type Rec = Record<string, number>;
export function C(p: { n: number }) {
  const o = { a: p.n } satisfies Rec;
  return <b>{o.a}</b>;
}
