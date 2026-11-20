## 悪い例

```ts
/** 期間内の日数を数える。 */
function countDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}
```

## 良い例

```ts
/**
 * 期間内の日数を数える。
 * @param start 期間の最初の日。この日も数える。
 * @param end 期間の最後の日。この日も数える。start より前なら 0 以下を返す。
 * @returns 期間に含まれる日数。
 */
function countDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}
```
