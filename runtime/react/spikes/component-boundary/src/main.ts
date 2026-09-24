// How a generic reconciler calls a component whose props type it cannot name.
// `createElement<P>` is specialised per `P`, so the adapter closure it builds
// knows `P`, while the element stores it as one uniform function type.

type Node = string;

class Element {
  readonly render: (props: unknown) => Node;
  readonly props: unknown;
  readonly key: string | null;
  constructor(render: (props: unknown) => Node, props: unknown, key: string | null) {
    this.render = render;
    this.props = props;
    this.key = key;
  }
}

function createElement<P>(type: (props: P) => Node, props: P, key: string | null): Element {
  return new Element((erased: unknown): Node => type(erased as P), props, key);
}

interface CounterProps {
  readonly count: number;
}
function Counter(props: CounterProps): Node {
  return "count=" + props.count;
}

interface LabelProps {
  readonly text: string;
  readonly loud: boolean;
}
function Label(props: LabelProps): Node {
  return props.loud ? props.text.toUpperCase() : props.text;
}

// The reconciler's side: no component or props type is named here.
function renderAll(elements: Element[]): Node {
  let out = "";
  for (const element of elements) out += "[" + element.render(element.props) + "]";
  return out;
}

export function mount(count: number, loud: boolean): Node {
  return renderAll([
    createElement<CounterProps>(Counter, {count}, null),
    createElement<LabelProps>(Label, {text: "hi", loud}, "k"),
  ]);
}
