// A value's built-in tag, `[object Array]` and the like: a fork point, since
// a native program's values have no prototype to ask (objectTag.native.ts).

export function objectTag(value: unknown): string {
  return Object.prototype.toString.call(value);
}
