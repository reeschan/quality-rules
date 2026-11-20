## 悪い例

```ts
// 割引の判断が、保存や現在時刻の読み取りと混ざっている。
async function checkout(cart: Cart) {
  const hour = new Date().getHours();
  const rate = hour >= 22 && cart.total > 5000 ? 0.1 : 0;
  await saveOrder({ ...cart, total: cart.total * (1 - rate) });
}
```

## 良い例

```ts
// 判断は、引数だけから結果を返す純粋な関数にする。
function discountRate(total: number, hour: number): number {
  return hour >= 22 && total > 5000 ? 0.1 : 0;
}

async function checkout(cart: Cart) {
  const rate = discountRate(cart.total, new Date().getHours());
  await saveOrder({ ...cart, total: cart.total * (1 - rate) });
}
```
