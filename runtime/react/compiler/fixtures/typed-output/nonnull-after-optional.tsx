import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { a?: { b?: string } }) {
  const s = p.a?.b!.length;
  return <b>{s}</b>;
}
