// libadwaita's AdwGroupNode: its placement comes from its type, and an unknown one throws.
import { GroupNode, type Placement } from "./children.ts";

function placementOf(type: string): Placement {
  if (type === "Start") return "start";
  if (type === "End") return "end";
  throw new Error(`no group <${type}>`);
}

export class AdwGroupNode extends GroupNode {
  constructor(type: string) {
    super(type, placementOf(type));
  }
}
