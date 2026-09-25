// JSX the compiler never sees: module scope, a lowercase function, a class
// component's methods. It is lowered all the same.
import { Component } from "react";

export const banner = <header id="top">Top &amp; more</header>;

export function renderRow(label: string) {
  // A comment the copy keeps.
  return (
    <tr>
      <td>{label}</td>
    </tr>
  );
}

export class Clock extends Component<{ at: string }> {
  render() {
    return <time dateTime={this.props.at}>{this.props.at}</time>;
  }
}
