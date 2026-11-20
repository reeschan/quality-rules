---
id: UNIT-1
layer: typescript
pack: unit-tests
added: 0.1.0
check: unit-tests/imported-by-tests
---

# 決めたフォルダに純粋な計算を足したら、同じ変更で単体テストを足す

## 理由

入力だけで結果が決まる純粋な計算は、単体テストを書くのが最も安く、直したときに壊れたことを最も早く知らせてくれる。あとで足そうとすると、足されないままになる。純粋な計算を置くフォルダをプロジェクトで決め、そこにファイルを足す変更には、そのファイルを import する単体テストを同じ変更で足す。フォルダとテストの置き場は、マニフェストのオプション（プロジェクトが決める値）として受ける。

## 悪い例

```ts
// src/calc/discount.ts を足したが、どのテストからも import されていない。
export function applyDiscount(price: number, rate: number): number {
  return Math.round(price * (1 - rate));
}
```

## 良い例

```ts
// src/calc/discount.ts
export function applyDiscount(price: number, rate: number): number {
  return Math.round(price * (1 - rate));
}

// test/calc/discount.test.ts （同じ変更で足す）
import { expect, it } from 'vitest';
import { applyDiscount } from '../../src/calc/discount';

it('takes the rate off the price and rounds', () => {
  expect(applyDiscount(1000, 0.15)).toBe(850);
});
```

## 確かめる問い

- 決めたフォルダに足したファイルを、単体テストが import しているか。
- そのテストは、同じ変更に入っているか。
- 決めたフォルダに、副作用や外部との通信を持つ処理が混ざっていないか。

## 機械では拾えない残り

ルールが見るのは、決めたフォルダの全ファイルがどれかの単体テストから import されているかだけ。次はレビューで見る。

- テストが import しているだけで、その計算の振る舞いを確かめていないこと。
- 正常な値だけで、境界や異常な値を確かめていないこと。
- 純粋な計算を、決めたフォルダの外に置いて検査を逃れていること。
