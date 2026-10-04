// Deprecated observational calendars are not canonical available values in
// ECMA-402. DateTimeFormat's compatibility resolution is separate.
export function availableCalendar(name: string): boolean {
  return name !== "islamic" && name !== "islamic-rgsa";
}
