## 悪い例

```ts
// 表示する側が、状態の値から「どう見せるか」の判断を持っている。
function StatusLabel(props: { status: string }) {
  if (props.status === 'paid' || props.status === 'refunded') {
    return renderBadge('完了', 'gray');
  }
  return renderBadge('未完了', 'red');
}
```

## 良い例

```ts
// 決める側で 1 回だけ判断し、受け手は渡された結果の通りに表示する。
function toStatusView(status: string): { label: string; color: string } {
  const done = status === 'paid' || status === 'refunded';
  return done ? { label: '完了', color: 'gray' } : { label: '未完了', color: 'red' };
}

function StatusLabel(props: { label: string; color: string }) {
  return renderBadge(props.label, props.color);
}
```
