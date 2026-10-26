// The only change from the ordinary dynamic-import control is its phase.
export const source = import.source("./dependency");
export const defer = import.defer("./dependency");
export const control = import("./dependency");
export const metadata = import.meta;
export function target() { return new.target; }
