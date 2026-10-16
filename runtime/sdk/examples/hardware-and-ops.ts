// Hardware family and operation-depth additions: all standard globals
// from lib.native-dom round 2, plus the filled SDK operations.
import { motion } from "@nts/sdk/location";
import { downloads } from "@nts/sdk/documents";
import { photos } from "@nts/sdk/photos";
import { notifications } from "@nts/sdk/notifications";

export async function readHeartRate(): Promise<number | undefined> {
  if (!(await navigator.bluetooth.getAvailability())) return undefined;
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
  const server = await device.gatt?.connect();
  const service = await server?.getPrimaryService("heart_rate");
  const ch = await service?.getCharacteristic("heart_rate_measurement");
  const value = await ch?.readValue();
  return value?.getUint8(1);
}

export async function firstSerialLine(): Promise<void> {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  const reader = port.readable?.getReader();
  await reader?.read();
  reader?.releaseLock();
  await port.close();
}

export async function dictate(): Promise<string> {
  return new Promise((resolve) => {
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.onresult = (e) => resolve(e.results[0]?.[0]?.transcript ?? "");
    rec.start();
  });
}

export async function writeNfcTag(text: string, signal: AbortSignal): Promise<void> {
  const reader = new NDEFReader();
  await reader.write({ records: [{ recordType: "text", data: text }] }, { signal });
}

export async function downloadBigFile(url: string): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const dest = await root.getFileHandle("big.bin", { create: true });
  const task = await downloads.start(url, dest);
  task.addEventListener("progress", (e) => console.log(e.receivedBytes, e.totalBytes));
  const watch = new FileSystemObserver((records) => console.log(records.length));
  await watch.observe(root);
  return task.completion;
}

export async function tidyLibrary(): Promise<void> {
  const album = await photos.createAlbum("Fieldwork");
  const recent = await photos.query({ kinds: ["photo"], sortBy: "createdAt", limit: 20 });
  await album.add(recent);
  await notifications.setChannel({ id: "sync", name: "Sync", importance: "low" });
  for await (const heading of await motion.watchHeading()) {
    if (heading.degrees >= 0) break;
  }
}

import { screenProtection } from "@nts/sdk/screen-protection";
export async function protectSecrets(): Promise<void> {
  await screenProtection.prevent();
  screenProtection.addEventListener("screenshot", () => console.log("screenshot detected"));
}

import { clipboardExtras } from "@nts/sdk/clipboard";
import { locale } from "@nts/sdk/locale";
import { browser } from "@nts/sdk/browser";
import { powerMode } from "@nts/sdk/power";

export async function clipboardFlow(): Promise<Blob | undefined> {
  // No-prompt peek first, standard read second.
  const types = await clipboardExtras.types();
  if (!types.some((t) => t.startsWith("image/"))) return undefined;
  const items = await navigator.clipboard.read();
  const img = items.find((i) => i.types.includes("image/png"));
  await clipboardExtras.writeSensitiveText("one-time-code");
  return img?.getType("image/png");
}

export async function localizedOpen(url: string): Promise<void> {
  const here = locale.preferred[0];
  console.log(here?.tag, here?.temperatureUnit, powerMode.lowPower);
  await browser.warmUp(url);
  await browser.open(url, { readerMode: true });
}
