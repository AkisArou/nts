// react-gtk's GroupNode, in its own module, with fields of its own.
import { HostNode } from "./host.ts";

export type Placement = "start" | "end";

export class GroupNode extends HostNode {
  private readonly placement: Placement;
  private readonly items: string[] = [];

  constructor(type: string, placement: Placement) {
    super(type);
    this.placement = placement;
  }
  where(): string {
    return this.placement + String(this.items.length);
  }
}
