---
id: STYLE-1
layer: typescript
pack: lint-hygiene
added: 0.1.0
check: import/no-relative-parent-imports
---

# 親フォルダへの相対 import は使わず、パス別名を使う

## 理由

`../../..` のような親フォルダへの相対 import は、ファイルを移すたびに書き直しが要り、段数を数えないと行き先も分からない。パス別名なら、どのファイルから書いても同じ形で、移動にも強い。別名の名前と指す先はプロジェクトの構成で決まるので、パッケージは固定せず、マニフェストのオプション（プロジェクトが決める値）と、プロジェクトの tsconfig の設定として受ける。同じフォルダやその下への相対 import（`./`）は使ってよい。

## 悪い例

```ts
import { formatDate } from '../../../shared/format-date';
import type { Account } from '../../types/account';
```

## 良い例

```ts
// 別名 @ が src を指すと決めたプロジェクトの例
import { formatDate } from '@/shared/format-date';
import type { Account } from '@/types/account';
import { toLabel } from './to-label';
```

## 確かめる問い

- 親フォルダへ上る `../` で始まる import が残っていないか。
- 別名が、プロジェクトの設定（tsconfig など）とマニフェストで同じものを指しているか。
- 同じフォルダの中の `./` の import まで、別名に直していないか。

## 機械では拾えない残り

ルールが拾うのは、親フォルダへの相対 import だけ。次はレビューで見る。

- 別名の設定が足りず、別名で書けない場所があること。
- 別名を使いながら、公開されていない内部のファイルまで import していること。
- 動的 import や、文字列で組み立てたパスなど、静的に見えない読み込み。
