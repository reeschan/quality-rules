---
id: TYPE-1
layer: typescript
pack: types
added: 0.1.0
check: none
---

# 共有する型は決めた 1 か所に寄せる

## 理由

複数のモジュールで使う型を、使う側のファイルごとに定義すると、同じ形の型が何本にも増える。片方だけ直して食い違い、どれが正なのか分からなくなる。共有する型を置く場所を 1 か所に決めて、そこから import すれば、型の形を変えるときに見る場所が 1 つで済み、探すときも迷わない。置き場所はプロジェクトの構成で決まるので、パッケージは場所を固定せず、マニフェストのオプション（プロジェクトが決める値）として受ける。

## 悪い例

```ts
// src/orders/total.ts
export interface Money {
  amount: number;
  currency: string;
}

// src/invoices/render.ts
// 同じ形の型を、別のファイルでもう一度書いている。
interface Money {
  amount: number;
  currency: string;
}
```

## 良い例

```ts
// src/types/money.ts （共有する型の置き場所として決めたフォルダ）
export interface Money {
  amount: number;
  currency: string;
}

// src/orders/total.ts
import type { Money } from '@/types/money';

// src/invoices/render.ts
import type { Money } from '@/types/money';
```

## 確かめる問い

- 2 つ以上のモジュールで使う型が、使う側のファイルの中で定義されていないか。
- 同じ形の型が、別々の場所に重ねて書かれていないか。
- 共有する型は、プロジェクトで決めた置き場所に置かれているか。
- 1 つのモジュールの中でしか使わない型まで、置き場所へ移していないか。

## 機械では拾えない残り

この規約を受け持つルールは無い。すべてレビューで見る。

- 共有している型が、決めた置き場所の外で定義されていること。
- 形が同じ型の重複（名前が違っても、実体が同じもの）。
- 置き場所へ移すべき型と、1 つのモジュールに閉じてよい型の見分け。
