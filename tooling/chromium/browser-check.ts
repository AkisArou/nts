// A real renderer and zygote through the same scope discovery as benchmark.ts.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openPage, type Page } from "./browser.ts";

const executable = resolve(process.argv[2]), output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const pages: Page[] = [];
const records: unknown[] = [];
try {
  for (let i = 0; i < 2; ++i) {
    const page = await openPage(executable, "data:text/html,<title>launch ownership</title>", {
      temporary: output, args: ["--disable-features=SpareRendererForSitePerProcess"], cpu: 16,
    });
    pages.push(page);
    const processes = await page.until(async () => {
      const members = await page.processes();
      return ["browser", "zygote", "renderer"].every(type => members.some(record => record.type === type)) ? members : undefined;
    }, "a real browser, zygote and renderer in their own launch scope");
    assert(processes.every(record => record.pid > 1));
    assert(processes.every(record => record.cgroup === page.cgroup), "every process must remain in this launch's cgroup");
    const call = ["--address", page.busAddress, "call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus"];
    const owner = execFileSync("busctl", [...call, "NameHasOwner", "s", "org.freedesktop.systemd1"], { encoding: "utf8" }).trim();
    assert.equal(owner, "b false", "the private bus must have no systemd owner");
    const portal = spawnSync("busctl", [...call, "StartServiceByName", "su", "org.freedesktop.portal.Desktop", "0"], { encoding: "utf8" });
    assert.notEqual(portal.status, 0, "the private bus must not activate a portal");
    assert.match(portal.stderr, /not provided by any \.service files/);
    const pinned = await page.pinForMeasurement();
    records.push({ unit: page.unit, cgroup: page.cgroup, busAddress: page.busAddress, systemdOwner: owner, portalActivation: portal.stderr.trim(), processes, affinities: pinned.affinities });
  }
  assert.notEqual(pages[0].unit, pages[1].unit);
  const first = new Set((await pages[0].processes()).map(record => record.pid));
  assert((await pages[1].processes()).every(record => !first.has(record.pid)), "two launches of the same executable must have disjoint membership");
  await pages[0].close();
  const stopped = await pages[0].processes().catch(error => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  assert.equal(stopped.length, 0, "stopping a launch must leave no process in its scope");
  assert((await pages[1].processes()).some(record => record.type === "renderer"), "stopping one scope must leave the other renderer alive");
  assert.equal(await pages[1].evaluate("document.title"), "launch ownership");
  await pages[1].close();
  await writeFile(resolve(output, "result.json"), JSON.stringify({ status: "passed", records }, null, 2) + "\n");
  console.log("PASS: two real launches keep browser, zygote and renderer in disjoint scopes; private buses have no systemd or portal activation; stopping one empties its scope and leaves the other alive");
} finally {
  for (let i = 0; i < pages.length; ++i) {
    pages[i].kill();
    await writeFile(resolve(output, `launch-${i}.log`), pages[i].log());
  }
}
