---
id: PROJ-1
layer: project
check: none
---

# タスクの題名は 1 か所で整えてから保存する

## 理由

タスクの題名は入力欄から来る。画面ごとに空白の削り方や長さの切り方が違うと、同じ題名が違う形で保存され、一覧の見え方もそろわない。整える処理を `normalizeTitle` の 1 か所に置けば、題名の決まりを変えるときに直す場所が 1 つで済む。

## 悪い例

```ts
setTasks(appendTask(tasks, draft));
```

## 良い例

```ts
setTasks(appendTask(tasks, normalizeTitle(draft)));
```

## 確かめる問い

- タスクに入る題名は、すべて `normalizeTitle` を通っているか。
- 題名を整える処理が、画面の側に書き足されていないか。

## 機械では拾えない残り

機械検査は無い。題名がどこから来るかは呼び出しを読まないと分からないので、レビューで全部を見る。
