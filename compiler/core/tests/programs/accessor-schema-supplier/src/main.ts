interface Options { readonly label?: string; }

interface Result { readonly label: string; }
interface GetterResult { readonly text: string; }

export class ComputedResult {
  get label(): string { return "computed"; }
  get text(): string { return "computed text"; }
}

export function textOf(value: GetterResult): string {
  return value.text;
}

function makeResult(): Result {
  return { label: "stored" };
}

export function resultLabel(): string {
  return makeResult().label;
}

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
