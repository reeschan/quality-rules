## 悪い例

```ts
// 使う側ごとに、同じ整形を繰り返している。
const isSameUser = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findUser = (users: User[], email: string) =>
  users.find((user) => user.email.trim().toLowerCase() === email.trim().toLowerCase());
```

## 良い例

```ts
// 値が入ってくる場所で 1 度だけ整える。使う側は整った値だけを扱う。
export function parseEmail(input: string): string {
  return input.trim().toLowerCase();
}

const isSameUser = (a: string, b: string) => a === b;
const findUser = (users: User[], email: string) => users.find((user) => user.email === email);
```
