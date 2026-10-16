// Geolocation (standard) in the foreground; an OS service behind a
// named task in the background; scheduled notification as the reminder.
import { backgroundLocation } from "@nts/sdk/location";
import { tasks } from "@nts/sdk/tasks";
import { notifications } from "@nts/sdk/notifications";
import { permissions } from "@nts/sdk/permissions";

// Module scope: must exist before a headless cold launch delivers fixes.
tasks.define("courier", (event) => {
  if (event.type === "location") {
    void fetch("https://example.invalid/fixes", {
      method: "POST",
      body: JSON.stringify(event.fixes.map((f) => f.coords)),
    });
    return "success";
  }
  return undefined;
});

export function watchForeground(onFix: (lat: number, lon: number) => void): number {
  return navigator.geolocation.watchPosition(
    (pos) => onFix(pos.coords.latitude, pos.coords.longitude),
    undefined,
    { enableHighAccuracy: true },
  );
}

export async function startBackgroundTracking(): Promise<boolean> {
  if ((await permissions.request("location-background")).state !== "granted") return false;
  await backgroundLocation.start({
    task: "courier",
    distanceFilter: 25,
    notification: { title: "Tracking", body: "Sharing your route" },
  });
  return true;
}

export async function remindSoon(): Promise<void> {
  new Notification("Starting now"); // standard, immediate
  await notifications.schedule( // SDK gap: scheduled
    { title: "Reminder", data: { kind: "demo" } },
    { type: "date", at: new Date(Date.now() + 60_000) },
  );
  const token = await notifications.getPushToken();
  if (token.type !== "web-push") console.log(token.type, token.token);
}
