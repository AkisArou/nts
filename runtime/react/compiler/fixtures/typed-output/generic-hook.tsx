import { useState, useRef, useReducer, useMemo, useCallback } from "react";
type Item = { id: number; name: string; done?: boolean };
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number };
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}
