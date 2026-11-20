## 悪い例

```ts
// src/pages/checkout/format-for-checkout-page.ts
export function formatForCheckoutPage(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}
```

## 良い例

```ts
// src/shared/format/format-currency.ts
export function formatCurrency(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}
```
