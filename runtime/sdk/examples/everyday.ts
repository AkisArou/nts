// The remaining everyday modules: calendar, linking, maps, platform facts.
import { app, platform } from "@nts/sdk/app";
import { calendar } from "@nts/sdk/calendar";
import { linking } from "@nts/sdk/linking";
import { permissions } from "@nts/sdk/permissions";

export async function addDeadline(title: string, at: Date): Promise<boolean> {
  if ((await permissions.request("calendar")).state !== "granted") return false;
  const cals = await calendar.calendars();
  const target = cals.find((c) => !c.readOnly);
  if (target === undefined) return false;
  await calendar.createEvent({
    calendarId: target.id,
    title,
    start: at,
    end: new Date(at.getTime() + 3_600_000),
    alerts: [60],
  });
  return true;
}

export async function openPlace(query: string): Promise<void> {
  void platform;
  await linking.open(`https://example.invalid/search?q=${encodeURIComponent(query)}`, {
    inAppBrowser: true,
  });
}

export function launchInfo(): string {
  return `${app.info.name} ${app.info.version} on ${platform.os}/${platform.host}` +
    (app.initialURL === undefined ? "" : ` via ${app.initialURL}`);
}
