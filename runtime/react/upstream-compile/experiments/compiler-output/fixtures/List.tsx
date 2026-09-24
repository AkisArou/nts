type Item = {
  id: number;
  label: string;
};

type Props = {
  items: readonly Item[];
};

export function List({items}: Props) {
  const rows = items.map(item => <row key={item.id} label={item.label} />);
  return <list>{rows}</list>;
}
