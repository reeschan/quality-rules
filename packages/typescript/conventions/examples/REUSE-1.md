## 悪い例

```ts
// すでに src/shared/array/chunk.ts があるのに、同じ役割の関数を別に作っている。
function splitIntoGroups<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}
```

## 良い例

```ts
import { chunk } from '@/shared/array/chunk';

const groups = chunk(items, 10);
```
