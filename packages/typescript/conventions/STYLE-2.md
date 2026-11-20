---
id: STYLE-2
layer: typescript
pack: lint-hygiene
added: 0.1.0
check: no-ternary
---

# 三項演算子を使わない

## 理由

三項演算子は、条件と 2 つの結果を 1 行に詰めるので、少し複雑になるだけで読み解くのに時間がかかる。入れ子にすると、どの条件がどの結果に対応するのか追えなくなる。`if` 文や、早く返す書き方、名前の付いた小さな関数なら、条件ごとに行が分かれ、結果に意味のある名前を付けられる。

## 悪い例

```ts
const label = count === 0 ? 'none' : count === 1 ? 'one' : 'many';
const title = user.isGuest ? 'Guest' : user.name;
```

## 良い例

```ts
function toCountLabel(count: number): string {
  if (count === 0) {
    return 'none';
  }
  if (count === 1) {
    return 'one';
  }
  return 'many';
}

let title = user.name;
if (user.isGuest) {
  title = 'Guest';
}
```

## 確かめる問い

- `? :` の形の式が残っていないか。
- 条件が増える式を、`if` 文や小さな関数に分けられないか。
- 三項演算子を避けるために、`&&` や `||` を何本も重ねて同じ読みにくさを作っていないか。

## 機械では拾えない残り

ルールが拾うのは、三項演算子そのものだけ。次はレビューで見る。

- 三項演算子を、`&&`・`||`・`??` の連なりに置き換えただけで、読みにくさが残っている式。
- `if` 文に分けたことで、値の決まり方が追いにくくなっている箇所。
