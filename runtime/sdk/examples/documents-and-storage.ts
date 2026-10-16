// OPFS (standard) for app files; documents for user files; KV for
// settings; the keychain for secrets — four tools, four jobs, no twins.
import { documents } from "@nts/sdk/documents";
import { storage } from "@nts/sdk/storage";
import { secureStorage } from "@nts/sdk/security";

export async function writeScratchFile(text: string): Promise<void> {
  const root = await navigator.storage.getDirectory(); // OPFS
  const fh = await root.getFileHandle("scratch.txt", { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function openUserDocument(): Promise<string | null> {
  const doc = await documents.open({ types: ["text/plain", ".md"] });
  if (doc === null) return null;
  await storage.set("lastDocument", doc.id); // grant survives restarts
  const file = await doc.getFile();
  return file.text();
}

export async function reopenLastDocument(): Promise<File | undefined> {
  const id = await storage.getString("lastDocument");
  if (id === undefined) return undefined;
  const doc = await documents.fromId(id);
  return doc.getFile();
}

export async function rememberToken(token: string): Promise<void> {
  const availability = await secureStorage.availability();
  if (!availability.available) throw new Error(`no secure storage: ${availability.reason}`);
  await secureStorage.set("api-token", token, { requireAuthentication: "Unlock your token" });
}
