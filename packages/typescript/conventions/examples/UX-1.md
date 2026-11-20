## 悪い例

```ts
// 仕様に「下書きを破棄できる」としか書かれていないのに、確認の有無を黙って決めている。
function discardDraft(draft: Draft): void {
  draftStore.remove(draft.id);
}
```

## 良い例

```ts
// 確認の有無は仕様に無いので、実装を止めて決める人に聞く。
// 質問: 破棄の前に確認ダイアログを出すか。案: 本文が空でなければ出す。
function discardDraft(draft: Draft): void {
  throw new Error('未決定: 破棄の確認の扱いが仕様に無い。回答待ち');
}
```
