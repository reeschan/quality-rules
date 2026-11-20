## 悪い例

```ts
// formatDate、formatTime、formatDuration と同じ。
function formatAmount(value: number): string {
  return value.toFixed(2);
}
```

## 良い例

```ts
// 小数第 2 位までの文字列にする。四捨五入は丸め誤差のある 2 進数のまま行う。
function formatAmount(value: number): string {
  return value.toFixed(2);
}
```
