export function Header(props: { title: string }) {
  return <h1>{props.title}</h1>;
}
export function Icon() {
  return <i />;
}
export const Panel = { Header, Icon };
