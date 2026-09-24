// A native program's last resort for an error nothing handled. The probe
// keeps them so a scenario can report them; a real host writes to its log.
class UncaughtErrors {
  readonly errors: unknown[] = [];
}

export const uncaughtErrors = new UncaughtErrors();

export function reportGlobalError(error: unknown): void {
  uncaughtErrors.errors.push(error);
}
