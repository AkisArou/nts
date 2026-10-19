/*---
description: A const enum exported from a namespace is read through the namespace's name.
features: [ts-enum, ts-const-enum, ts-namespace]
---*/
namespace Http {
  export const enum Status { Ok = 200, NotFound = 404 }
}
function isError(status: Http.Status): boolean {
  return status >= 400;
}
assert.sameValue(Http.Status.NotFound, 404);
assert.sameValue(isError(Http.Status.Ok), false);
assert.sameValue(isError(Http.Status.NotFound), true);
