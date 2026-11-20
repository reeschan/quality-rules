## 悪い例

```ts
// 呼び出し側を読んでも、true が何を切り替えるのか分からない。
sendMessage(user, true);
renderReport(orders, false, true);
```

## 良い例

```ts
sendReminderMessage(user);
renderSummaryReport(orders);
```
