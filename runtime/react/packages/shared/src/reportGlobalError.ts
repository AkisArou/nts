// Reports an error that has nowhere else to go, the way an uncaught error
// would be. Chosen once when the module loads, as upstream does:
// `reportError` in modern browsers; otherwise an `error` event in a browser,
// an `uncaughtException` in node, or the console.
export const reportGlobalError: (error: unknown) => void =
  typeof reportError === "function" ? reportError : reportGlobalErrorFallback;

function reportGlobalErrorFallback(error: unknown): void {
  if (typeof window === "object" && typeof window.ErrorEvent === "function") {
    const message =
      typeof error === "object" &&
      error !== null &&
      typeof (error as { message?: unknown }).message === "string"
        ? String((error as { message: string }).message)
        : String(error);
    const event = new window.ErrorEvent("error", {
      bubbles: true,
      cancelable: true,
      message,
      error,
    });
    if (!window.dispatchEvent(event)) {
      return;
    }
  } else if (typeof process === "object" && typeof process.emit === "function") {
    // Node's typings require an Error; node itself passes any value through.
    (process.emit as (event: string, value: unknown) => boolean)("uncaughtException", error);
    return;
  }
  console.error(error);
}
