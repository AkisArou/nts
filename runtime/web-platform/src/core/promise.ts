export function ignoreRejection(promise: Promise<unknown>): void {
  promise.catch(() => {});
}
