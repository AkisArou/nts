import { gzipSync, deflateRawSync, crc32 } from "node:zlib";
// Payloads chosen for the shapes the decoder branches on, not for variety.
const payloads = [
  Buffer.alloc(0),
  Buffer.from("a"),
  Buffer.from("the quick brown fox jumps over the lazy dog ".repeat(40)),
  Buffer.from(Array.from({ length: 70000 }, (_, i) => i & 0xff)),   // > one inflate window
  Buffer.from(Array.from({ length: 4096 }, () => 0)),               // maximally compressible
];
function customHeader(payload, { extra, name, comment, hcrc }) {
  let flg = 0;
  const parts = [];
  if (extra) flg |= 4;
  if (name) flg |= 8;
  if (comment) flg |= 16;
  if (hcrc) flg |= 2;
  const head = Buffer.from([0x1f, 0x8b, 8, flg, 0, 0, 0, 0, 0, 3]);
  parts.push(head);
  if (extra) { const x = Buffer.from(extra); parts.push(Buffer.from([x.length & 0xff, x.length >> 8]), x); }
  if (name) parts.push(Buffer.from(name, "latin1"), Buffer.from([0]));
  if (comment) parts.push(Buffer.from(comment, "latin1"), Buffer.from([0]));
  let header = Buffer.concat(parts);
  if (hcrc) {
    const c = crc32(header) & 0xffff;
    header = Buffer.concat([header, Buffer.from([c & 0xff, c >> 8])]);
  }
  const body = deflateRawSync(payload);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(payload) >>> 0, 0);
  trailer.writeUInt32LE(payload.length >>> 0, 4);
  return Buffer.concat([header, body, trailer]);
}
const cases = [];
for (const [i, p] of payloads.entries()) cases.push({ name: `plain-${i}`, gz: gzipSync(p), plain: p });
const p = payloads[2];
cases.push({ name: "extra", gz: customHeader(p, { extra: "XX" }), plain: p });
cases.push({ name: "name", gz: customHeader(p, { name: "file.txt" }), plain: p });
cases.push({ name: "comment", gz: customHeader(p, { comment: "a comment" }), plain: p });
cases.push({ name: "hcrc", gz: customHeader(p, { hcrc: true }), plain: p });
cases.push({ name: "all-fields", gz: customHeader(p, { extra: "EXTRA", name: "n", comment: "c", hcrc: true }), plain: p });
for (const c of cases) {
  console.log(`${c.name} ${c.gz.toString("hex")} ${c.plain.toString("hex")}`);
}
