## 悪い例

```ts
// 名前からは何も分からないが、保存して在庫も減らし、合計を返す。
export function handleOrder(order: Order): number {
  inventory.reserve(order.items);
  orderStore.save(order);
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
```

## 良い例

```ts
export function calculateOrderTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function placeOrder(order: Order): void {
  inventory.reserve(order.items);
  orderStore.save(order);
}
```
