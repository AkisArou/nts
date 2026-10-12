interface Options { readonly label?: string; }

export class Resource {
  state: { destroyed: boolean } | undefined;
  constructor() {
    this.state = undefined;
    const state = { destroyed: false };
    this.state = state;
  }
  destroy(): void {
    if (this.state !== undefined) this.state.destroyed = true;
  }
}

export function readLabel(value: Options): string {
  return value.label ?? "absent";
}

export function stateAfterDestroy(destroy: boolean): boolean {
  const resource = new Resource();
  if (destroy) resource.destroy();
  return resource.state === undefined ? false : resource.state.destroyed;
}
