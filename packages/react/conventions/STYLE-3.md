---
id: STYLE-3
layer: react
pack: react
added: 0.1.0
check: quality-rules/no-props-destructuring
---

# props は分割代入せず、props.xxx で参照する

## 理由

コンポーネントの引数で props を分割代入すると、本体の中の `title` や `onClose` が、props から来た値なのか、手元の変数なのか区別できなくなる。`props.title` と書けば、読んだ場所で出どころが分かり、同じ名前の変数を作ってしまう間違いも防げる。props の数が増えても、引数の並びが長くならない。

## 悪い例

```tsx
function UserCard({ name, onSelect }: UserCardProps) {
  return <button type="button" onClick={onSelect}>{name}</button>;
}
```

## 良い例

```tsx
function UserCard(props: UserCardProps) {
  return (
    <button type="button" onClick={props.onSelect}>
      {props.name}
    </button>
  );
}
```

## 確かめる問い

- コンポーネントの引数に、`{ ... }` の分割代入が書かれていないか。
- 本体の中で、props の値を `props.xxx` の形で参照しているか。
- 引数ではなく、本体の最初で `const { name } = props;` と分割していないか。

## 機械では拾えない残り

ルールが拾うのは、コンポーネントの引数での分割代入だけ。次はレビューで見る。

- 本体の中で `props` を分割代入して、出どころを隠している箇所。
- コンポーネントでない関数や、独自のフックの引数。
- 同じ props を何度も参照して読みにくくなっている場合の、整理の仕方。
