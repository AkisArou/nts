import assert from "node:assert/strict";
/** Type-only annotations: every engine executes the same timing loop. */
export function typedTimer(source: string): string {
  for (const [from, to] of [
    ["function checksumBits(value) {", "function checksumBits(value: number): string {"],
    [
      "function perfCommand(control, acknowledgement, value) {",
      "function perfCommand(control: number, acknowledgement: number, value: string): void {",
    ],
    [
      "function runLoop(run, reps) {",
      "function runLoop(run: () => number, reps: number): number {",
    ],
    [
      "function calibrate(run, checksum) {",
      "function calibrate(run: () => number, checksum: number): void {",
    ],
    [
      "function count(run, checksum) {",
      "function count(run: () => number, checksum: number): void {",
    ],
    ["export function measure(run) {", "export function measure(run: () => number): void {"],
    [
      "async function runLoopAsync(run, reps) {",
      "async function runLoopAsync(run: () => Promise<number>, reps: number): Promise<number> {",
    ],
    [
      "async function calibrateAsync(run, checksum) {",
      "async function calibrateAsync(run: () => Promise<number>, checksum: number): Promise<void> {",
    ],
    [
      "async function countAsync(run, checksum) {",
      "async function countAsync(run: () => Promise<number>, checksum: number): Promise<void> {",
    ],
    [
      "export async function measureAsync(run) {",
      "export async function measureAsync(run: () => Promise<number>): Promise<void> {",
    ],
    [
      "openSync(process.env.NTS_BENCH_COUNT_CONTROL,",
      "openSync(process.env.NTS_BENCH_COUNT_CONTROL!,",
    ],
    ["openSync(process.env.NTS_BENCH_COUNT_ACK,", "openSync(process.env.NTS_BENCH_COUNT_ACK!,"],
    [
      "export function opaqueInput(value) {",
      "export function opaqueInput(value: number): number {",
    ],
  ]) {
    assert.equal(
      source.split(from).length,
      2,
      "canonical timer changed; review its typed projection",
    );
    source = source.replace(from, to);
  }
  return source;
}
