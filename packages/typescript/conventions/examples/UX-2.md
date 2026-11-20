## 悪い例

```ts
function sortTasks(tasks: Task[]): Task[] {
  // 同じ期限のときの並びが原文に無いのに、仕様どおりのように書いている。
  return [...tasks].sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title));
}
```

## 良い例

```ts
function sortTasks(tasks: Task[]): Task[] {
  // 仮決め: 同じ期限のときはタイトル順にする（原文に指定が無い）。
  // 理由: 並びを安定させるため。確認先: 仕様の担当者。
  return [...tasks].sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title));
}
```
