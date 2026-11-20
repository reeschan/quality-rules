## 悪い例

```ts
// 合計がマイナスになる原因は割引の計算にあるのに、出口で隠している。
export function calculateTotal(subtotal: number, discount: number): number {
  return Math.max(0, subtotal - discount);
}
```

## 良い例

```ts
// 割引が小計を超えないように、原因の計算を直す。
export function calculateDiscount(subtotal: number, rate: number): number {
  return Math.min(subtotal, Math.round(subtotal * rate));
}

export function calculateTotal(subtotal: number, discount: number): number {
  return subtotal - discount;
}
```
