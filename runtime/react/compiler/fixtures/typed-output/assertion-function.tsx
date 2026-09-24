import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function assertStr(v: unknown): asserts v is string { if (typeof v !== "string") throw new Error(); }
export function C(p: { v: unknown }) {
  assertStr(p.v);
  const n = p.v.length;
  return <b>{n}</b>;
}
