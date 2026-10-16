// Desktop step-6 modules in use. Every one degrades honestly off-desktop.
import { app } from "@nts/sdk/app";
import { appearance } from "@nts/sdk/appearance";
import { displays } from "@nts/sdk/displays";
import { windows } from "@nts/sdk/windows";
import { shell } from "@nts/sdk/shell";
import { capture } from "@nts/sdk/capture";
import { power } from "@nts/sdk/power";

export async function ensureSingleInstance(): Promise<boolean> {
  const mine = await app.requestSingleInstanceLock();
  if (mine) {
    app.addEventListener("secondinstance", (e) => {
      if (e.url !== undefined) void windows.main.focus();
    });
  }
  return mine;
}

export async function openOnSecondaryDisplay(): Promise<void> {
  const all = await displays.all();
  const external = all.find((d) => !d.isPrimary) ?? all[0];
  if (external === undefined) return;
  await windows.open({
    content: "dashboard",
    title: appearance.state.colorScheme === "dark" ? "Dashboard (dark)" : "Dashboard",
    position: { x: external.workArea.x + 40, y: external.workArea.y + 40 },
    size: { width: 1024, height: 640 },
  });
}

export async function recordChosenWindow(): Promise<MediaStream | undefined> {
  const preferred = await navigator.mediaDevices.getDisplayMedia({ video: true }).catch(() => undefined);
  if (preferred !== undefined) return preferred;
  const sources = await capture.sources({ kinds: ["window"] });
  const first = sources[0];
  return first === undefined ? undefined : first.stream();
}

export async function exportAndReveal(fileUrl: URL): Promise<void> {
  using _blocker = await power.preventSleep("Exporting report");
  await shell.reveal(fileUrl);
}
