// Correctness comes from the Benchmarks Game's published output files, not
// from running one of these ports to manufacture its own expected result.
// Discover installed rows so each program can land in its own pull request.
// Run with: node --test benchmarks/clbg.test.ts
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

interface ClbgCase {
  render(n: number): string;
  work(n: number): number;
  seed: number;
}

const casesUrl = new URL("./cases/", import.meta.url);
const cases = readdirSync(casesUrl, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("clbg-"))
  .map((entry) => entry.name)
  .sort();
assert.ok(cases.length > 0, "at least one CLBG case must be installed");

function expected(url: URL): string {
  const file = readFileSync(url, "utf8");
  assert.ok(file.startsWith("/*\n"), `${url}: missing licence header`);
  const end = file.indexOf("*/\n");
  assert.ok(end >= 0, `${url}: unterminated licence header`);
  const header = file.slice(0, end);
  assert.match(header, /BSD-3-Clause/);
  assert.match(header, /Copyright/);
  assert.match(header, /https?:\/\//);
  const payload = file.slice(end + 3);
  // PBM is binary. Its published bytes are encoded losslessly to permit a
  // licence notice in expected-200.txt; text fixtures retain every byte.
  if (header.includes("Encoding: base64")) {
    return Buffer.from(payload.replace(/\s/g, ""), "base64").toString("latin1");
  }
  return payload;
}

function checksum(output: string): number {
  let hash = 0;
  for (let i = 0; i < output.length; i++) {
    hash = (hash * 31 + output.charCodeAt(i)) >>> 0;
  }
  return hash;
}

for (const name of cases) {
  const directory = new URL(`${name}/`, casesUrl);
  const fixtures = readdirSync(directory).filter((file) => /^expected-\d+\.txt$/.test(file));
  assert.ok(fixtures.length > 0, `${name}: missing published output`);
  const benchmark: ClbgCase = await import(new URL("case.ts", directory).href);

  for (const fixture of fixtures) {
    const n = Number(fixture.slice("expected-".length, -".txt".length));
    test(`${name}: published output at n=${n}`, () => {
      const oracle = expected(new URL(fixture, directory));
      assert.equal(benchmark.render(n), oracle);
      assert.equal(benchmark.work(n), checksum(oracle));
    });
  }

  test(`${name}: repeated calls reset state and checksum the complete output`, () => {
    assert.ok(Number.isSafeInteger(benchmark.seed) && benchmark.seed > 0);
    const output = benchmark.render(benchmark.seed);
    const value = checksum(output);
    assert.equal(benchmark.work(benchmark.seed), value);
    // A different input between repetitions catches an RNG/table state leak.
    benchmark.work(benchmark.seed + 1);
    assert.equal(benchmark.render(benchmark.seed), output);
    assert.equal(benchmark.work(benchmark.seed), value);
  });

  if (name === "clbg-mandelbrot") {
    test(`${name}: partial PBM bytes keep row padding clear`, () => {
      for (const width of [1, 7, 9, 17]) {
        const header = `P4\n${width} ${width}\n`;
        const output = benchmark.render(width);
        const stride = Math.ceil(width / 8);
        assert.ok(output.startsWith(header));
        assert.equal(output.length, header.length + width * stride);
        const paddingMask = (1 << (8 - width % 8)) - 1;
        for (let row = 0; row < width; row++) {
          assert.equal(output.charCodeAt(header.length + (row + 1) * stride - 1) & paddingMask, 0);
        }
      }
    });
  }

  if (name === "clbg-pidigits") {
    test(`${name}: final output lines preserve leading zeroes`, () => {
      // Digits 51–60 in the source program's published pi output.
      assert.ok(benchmark.render(51).endsWith("0         \t:51\n"));
      assert.ok(benchmark.render(60).endsWith("0582097494\t:60\n"));
    });
  }
}
