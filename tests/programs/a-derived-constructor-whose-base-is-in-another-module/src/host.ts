// react-gtk's HostNode: the abstract root of every node.
export abstract class HostNode {
  readonly type: string;
  constructor(type: string) {
    this.type = type;
  }
}

// WidgetSet: a factory kept and called later.
export class WidgetSet {
  readonly name: string;
  private readonly create: (type: string) => HostNode | null;
  constructor(name: string, create: (type: string) => HostNode | null) {
    this.name = name;
    this.create = create;
  }
  make(type: string): HostNode | null {
    return this.create(type);
  }
}
