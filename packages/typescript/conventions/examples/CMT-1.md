## 悪い例

```ts
// 注文一覧の画面が、ページ送りのために呼ぶ。
function sliceByPage<T>(items: T[], page: number, size: number): T[] {
  return items.slice(page * size, (page + 1) * size);
}
```

## 良い例

```ts
// 0 始まりのページ番号に当たる範囲の要素を、元の順のまま返す。
function sliceByPage<T>(items: T[], page: number, size: number): T[] {
  return items.slice(page * size, (page + 1) * size);
}
```
