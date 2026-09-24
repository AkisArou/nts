import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  let label: string | null;
  if (p.n > 0) { label = "pos"; } else { label = null; }
  return <b>{label}</b>;
}
