---
id: TYPE-2
layer: typescript
pack: types
added: 0.1.0
check: none
---

# 種類を表す文字列は直書きせず、as const のオブジェクトと同名の型にする

## 理由

種類を表す文字列（状態・区分・イベントの名前など）をあちこちに直書きすると、綴りの間違いを型が見つけられず、値の一覧もどこにも無い。値を `as const` のオブジェクトにまとめ、同じ名前の型をそこから導けば、使う側は `Status.active` のように名前で参照でき、候補の追加や名前の変更も 1 か所で済む。値と型が同じ名前なので、import も 1 つで足りる。

## 悪い例

```ts
// 文字列を直書きしている。綴りを間違えても気づけない。
function canEdit(status: string): boolean {
  return status === 'draft' || status === 'reviewing';
}

type Status = 'draft' | 'reviewing' | 'published';
```

## 良い例

```ts
export const Status = {
  draft: 'draft',
  reviewing: 'reviewing',
  published: 'published',
} as const;

export type Status = (typeof Status)[keyof typeof Status];

function canEdit(status: Status): boolean {
  return status === Status.draft || status === Status.reviewing;
}
```

## 確かめる問い

- 種類を表す文字列を、比較や引数にそのまま書いていないか。
- 取りうる値の一覧が、`as const` のオブジェクトとして 1 か所にあるか。
- 型が、そのオブジェクトから導かれていて（手で並べ直していない）、同じ名前になっているか。
- 外から来る文字列を、この型に絞らないまま使っていないか。

## 機械では拾えない残り

この規約を受け持つルールは無い。すべてレビューで見る。

- 直書きされた種類の文字列と、型の中に手で並べ直された値。
- 一覧にすべき値か、ただの文言かの見分け。
- 外から入る文字列を検証して型に絞っているか。
