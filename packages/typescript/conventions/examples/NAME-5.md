## 悪い例

```ts
// 通常の処理と同じ調子で、例外の扱いが紛れ込んでいる。
export function applyRule2(order: Order): Order {
  return { ...order, shippingFee: 0 };
}

// 値を、使われている場所で名付けている。
export const SEARCH_BOX_NUMBER = 300;
```

## 良い例

```ts
export function applyBulkOrderShippingException(order: Order): Order {
  return { ...order, shippingFee: 0 };
}

export const DEBOUNCE_DELAY_MS = 300;
```
