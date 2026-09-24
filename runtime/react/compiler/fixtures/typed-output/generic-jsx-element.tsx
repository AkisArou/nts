import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function Row<T>(p: { value: T; show: (v: T) => string }) { return <i>{p.show(p.value)}</i>; }
export function C(p: { n: number }) {
  return <Row<number> value={p.n} show={(v) => v.toFixed(1)} />;
}
