## 悪い例

```ts
export function getOrdersFromLast7Days(orders: Order[], now: Date): Order[] {
  const from = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return orders.filter((order) => order.createdAt.getTime() >= from);
}
```

## 良い例

```ts
export function getOrdersSince(orders: Order[], from: Date): Order[] {
  return orders.filter((order) => order.createdAt.getTime() >= from.getTime());
}
```
