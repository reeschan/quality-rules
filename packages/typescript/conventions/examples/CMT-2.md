## 悪い例

```ts
// 空の文字列を渡すと例外を投げる。
function normalizeName(name: string): string {
  // 実際には、例外を投げずに既定の名前を返すように変わっている。
  return name.trim() || 'anonymous';
}
```

## 良い例

```ts
// 前後の空白を除く。結果が空なら 'anonymous' を返す。
function normalizeName(name: string): string {
  return name.trim() || 'anonymous';
}
```
