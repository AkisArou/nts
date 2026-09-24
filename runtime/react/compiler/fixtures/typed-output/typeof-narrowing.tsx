import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { v: string | number }) {
  const s = typeof p.v === "string" ? p.v.toUpperCase() : p.v.toFixed(2);
  return <b>{s}</b>;
}
