// expect: a property `ignore` of unrepresentable type
//
// Node26 migration work-list finding: fs.cp and fs.watch are implemented,
// but normalizeCpOptions/watch read the full IgnorePattern union. On pin
// ab508+c8a (53fc), their compiled exports are absent and the socket/watch
// tests fail before holding. Only the ignore field type changes in the control.
// No callback or RegExp is executed: representing the property is the subject.
type IgnorePattern = string | RegExp | ((path: string) => boolean) | string[] | null;
interface Options { ignore?: IgnorePattern; }
interface StringOptions { ignore?: string; }
function readIgnore(options: Options): number {
  const ignore = options.ignore;
  return typeof ignore === "string" ? ignore.length : 0;
}
function readStringIgnore(options: StringOptions): number {
  const ignore = options.ignore;
  return typeof ignore === "string" ? ignore.length : 0;
}
export function subject(value: number): number {
  return value + readIgnore({ignore: "tmp"});
}
export function control(value: number): number {
  return value + readStringIgnore({ignore: "tmp"});
}
