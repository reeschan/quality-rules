## 悪い例

```ts
// 何が読み込み中なのか分からない。注文と利用者が同じ画面にあると区別できない。
let isLoading = false;
let isDone = false;
```

## 良い例

```ts
let isOrderLoading = false;
let isPaymentConfirmed = false;
```
