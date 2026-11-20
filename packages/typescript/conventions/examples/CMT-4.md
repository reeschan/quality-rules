## 悪い例

```ts
// repository.ts: 失敗したら 3 回まで、間を倍々に空けて再試行する。
export function fetchItems() { /* ... */ }

// service.ts: 失敗したら 3 回まで、間を倍々に空けて再試行する。
export function loadItems() { return fetchItems(); }

// handler.ts: 失敗したら 3 回まで、間を倍々に空けて再試行する。
export function handleList() { return loadItems(); }
```

## 良い例

```ts
// repository.ts: 失敗したら 3 回まで、間を倍々に空けて再試行する。
export function fetchItems() { /* ... */ }

// service.ts
export function loadItems() { return fetchItems(); }

// handler.ts
export function handleList() { return loadItems(); }
```
