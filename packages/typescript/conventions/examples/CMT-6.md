## 悪い例

```ts
// items の各要素を順に見て、価格を足して、合計を返す。
function sumPrices(items: Item[]): number {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}
```

## 良い例

```ts
// 価格は税抜きの整数（円）として足す。items が空なら 0 を返す。
// 通貨の違う要素が混ざった配列は、呼ぶ側で分けてから渡すこと。
function sumPrices(items: Item[]): number {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}
```
