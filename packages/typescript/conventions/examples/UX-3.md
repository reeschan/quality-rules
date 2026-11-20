## 悪い例

```ts
// 「保存」という名前なのに、公開まで一緒に行う。
async function saveArticle(article: Article): Promise<void> {
  await articleApi.save(article);
  await articleApi.publish(article.id);
  await notifier.sendToFollowers(article.id);
}
```

## 良い例

```ts
async function saveArticle(article: Article): Promise<void> {
  await articleApi.save(article);
}

// 公開と通知は、名前どおりの別の操作にする。
async function publishArticle(articleId: string): Promise<void> {
  await articleApi.publish(articleId);
  await notifier.sendToFollowers(articleId);
}
```
