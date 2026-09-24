import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function C(p: { n: number }) {
  enum Dir { Up, Down }
  const d = p.n > 0 ? Dir.Up : Dir.Down;
  return <b>{d}</b>;
}
