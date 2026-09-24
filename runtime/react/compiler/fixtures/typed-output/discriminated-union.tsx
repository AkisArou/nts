import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { s: Shape }) {
  let area: number;
  if (p.s.kind === "circle") { area = p.s.r * p.s.r * 3; } else { area = p.s.side * p.s.side; }
  return <b>{area}</b>;
}
