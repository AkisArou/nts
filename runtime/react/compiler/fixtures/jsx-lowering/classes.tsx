// Class components as tags: a class lowers to its descriptor, `Panel.$$type`,
// and a function component beside it stays itself. The class extending
// another class component inherits its lifecycles. `Page` is a component the
// compiler compiles, so its tags come from the compiled output.
import { Component, PureComponent } from "react";

export class Panel extends Component<{ title: string; children?: unknown }> {
  componentDidMount() {}
  render() {
    return (
      <section>
        <h1>{this.props.title}</h1>
        {this.props.children}
      </section>
    );
  }
}

export class Wide extends Panel {
  componentWillUnmount() {}
}

export class Badge extends PureComponent<{ n: number }> {
  static displayName = "Count";
  render() {
    return <b>{this.props.n}</b>;
  }
}

function Caption({ text }: { text: string }) {
  return <i>{text}</i>;
}

export function Page({ n }: { n: number }) {
  return (
    <Panel title="Page">
      <Badge n={n} />
      <Wide title="Wide" />
      <Caption text="caption" />
    </Panel>
  );
}
