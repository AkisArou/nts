export function ignoreRejection(promise: Promise<unknown>): void {
  observeRejection(promise);
}

async function observeRejection(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // The caller deliberately detached this operation.
  }
}
