## 悪い例

```ts
// 在庫数を、倉庫の管理と画面の表示がそれぞれ持っている。
const warehouse = { stock: 10 };
const view = { stock: 10 };

function receive(count: number) {
  warehouse.stock += count;
  // view を直し忘れると、画面の数字だけが古いまま残る。
}
```

## 良い例

```ts
const warehouse = { stock: 10 };

function receive(count: number) {
  warehouse.stock += count;
}

// 表示は、持っている 1 か所から読む。
function readStock(): number {
  return warehouse.stock;
}
```
