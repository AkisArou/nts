import { ReactContext } from "shared/ReactContext.ts";

export function createContext<T>(defaultValue: T): ReactContext<T> {
  return new ReactContext<T>(defaultValue);
}
