## 悪い例

```ts
if (
  order.total >= 5000 &&
  !order.items.some((item) => item.isOversized) &&
  (order.customer.isMember || order.coupon?.type === 'free-shipping')
) {
  order.shippingFee = 0;
}
```

## 良い例

```ts
function isEligibleForFreeShipping(order: Order): boolean {
  const hasOversizedItem = order.items.some((item) => item.isOversized);
  const hasShippingBenefit = order.customer.isMember || order.coupon?.type === 'free-shipping';
  return order.total >= 5000 && !hasOversizedItem && hasShippingBenefit;
}

if (isEligibleForFreeShipping(order)) {
  order.shippingFee = 0;
}
```
