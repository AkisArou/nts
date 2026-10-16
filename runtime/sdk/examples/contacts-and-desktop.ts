// Contact Picker (standard) covers picking; SDK covers the address book.
// Desktop: windows/menus/tray are pure SDK gaps.
import { contacts } from "@nts/sdk/contacts";
import { app } from "@nts/sdk/app";
import { windows } from "@nts/sdk/windows";
import { menus, tray } from "@nts/sdk/shell";
import { haptics } from "@nts/sdk/device";

export async function pickPeople(): Promise<string[]> {
  const picked = await navigator.contacts.select(["name", "email"], { multiple: true });
  return picked.flatMap((p) => p.name ?? []);
}

export async function findAlice(): Promise<void> {
  const people = await contacts.query({ name: "Alice" });
  if (people.length === 0) {
    await contacts.create({
      name: { given: "Alice", display: "Alice" },
      phones: [{ label: "mobile", value: "123456789" }],
      emails: [],
      addresses: [],
    });
  }
  await haptics.notification("success");
}

export async function openSettingsWindow(icon: Uint8Array): Promise<void> {
  const settings = await windows.open({
    id: "settings",
    title: `Settings — ${app.info.name}`,
    content: "settings",
    size: { width: 800, height: 600 },
  });
  await settings.focus();
  const menu = menus.build([
    { role: "app", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] },
    { label: "Theme", id: "theme", accelerator: "CmdOrCtrl+T" },
  ]);
  await menus.setApplicationMenu(menu);
  using trayIcon = await tray.create({ icon, tooltip: app.info.name, menu });
  trayIcon.addEventListener("click", () => void settings.show());
}
