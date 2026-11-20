import { memo } from 'react';

export function Greeting(props: { name: string }) {
  return <p>{props.name}</p>;
}

export const Badge = (props: { label: string }) => <span>{props.label}</span>;

export const Card = memo((props: { title: string }) => <section>{props.title}</section>);

export function NoProps() {
  return <hr />;
}

// Not components: the name does not start with an uppercase letter.
export function sumPair({ left, right }: { left: number; right: number }): number {
  return left + right;
}

export const pickLabel = ({ label }: { label: string }) => label;

// Destructuring in the body or in a second parameter is not a props parameter.
export function Body(props: { items: string[] }) {
  const { items } = props;
  return <ul>{items.length}</ul>;
}

export function Second(props: { id: string }, { extra }: { extra: string }) {
  return <i>{props.id + extra}</i>;
}

// A callback inside a component is not a component.
export function List(props: { rows: { id: string }[] }) {
  return <ul>{props.rows.map(({ id }) => <li key={id}>{id}</li>)}</ul>;
}
