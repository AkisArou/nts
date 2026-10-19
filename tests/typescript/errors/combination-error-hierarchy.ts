/*---
description: An abstract error class with two subclasses, a typed result union, and a handler narrowing unknown by instanceof.
features: [ts-errors, ts-class, ts-abstract, ts-builtin-subclass, ts-unknown, ts-narrowing, ts-discriminated-unions]
---*/
abstract class AppError extends Error {
  abstract readonly status: number;
}
class NotFound extends AppError {
  readonly status = 404;
}
class Forbidden extends AppError {
  readonly status = 403;
}
type Reply = { ok: true; body: string } | { ok: false; status: number; reason: string };
function handle(action: () => string): Reply {
  try {
    return { ok: true, body: action() };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, status: error.status, reason: error.message };
    return { ok: false, status: 500, reason: error instanceof Error ? error.name : "unknown" };
  }
}
const summary = [() => "page", () => { throw new NotFound("gone"); }, () => { throw new Forbidden("no"); }, () => { throw new TypeError(); }]
  .map(handle)
  .map((r) => (r.ok ? r.body : `${r.status} ${r.reason}`));
assert.compareArray(summary, ["page", "404 gone", "403 no", "500 TypeError"]);
