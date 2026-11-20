## 悪い例

```ts
// 閉じたモジュール billing の、公開ファイル以外を外から読んでいる。
import { roundTax } from '@/billing/internal/round-tax';
```

## 良い例

```ts
// 公開ファイル（index.ts）に出ているものだけを読む。
import { calculateTotal } from '@/billing';
```
