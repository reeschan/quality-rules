import { forwardRef, memo } from 'react';
import * as React from 'react';

export function Greeting({ name }: { name: string }) {
  return <p>{name}</p>;
}

export const Badge = ({ label, tone = 'info' }: { label: string; tone?: string }) => (
  <span className={tone}>{label}</span>
);

export const Title = function ({ text }: { text: string }) {
  return <h1>{text}</h1>;
};

export const Card = memo(({ title }: { title: string }) => <section>{title}</section>);

export const Field = forwardRef<HTMLInputElement, { id: string }>(({ id }, ref) => (
  <input id={id} ref={ref} />
));

export const Row = React.memo(function Row({ cells }: { cells: string[] }) {
  return <tr>{cells.length}</tr>;
});

export function Defaulted({ size } = { size: 1 }) {
  return <i>{size}</i>;
}
