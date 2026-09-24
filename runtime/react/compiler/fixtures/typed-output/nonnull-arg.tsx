import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
function len(s: string): number { return s.length; }
export function C(p: { name?: string }) {
  const n = len(p.name!);
  return <b>{n}</b>;
}
