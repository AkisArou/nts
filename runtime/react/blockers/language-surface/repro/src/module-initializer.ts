const source: unknown = {id: 1};
const rendered: string = String(source);

export function renderedLength(): number {
  return rendered.length;
}
