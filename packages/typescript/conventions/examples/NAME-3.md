## 悪い例

```ts
// 名前は一覧だが、実体は id から引く辞書。
const userList: Map<string, User> = new Map();

// 名前は名前だけだが、実体はフォルダを含むパス。
const fileName = path.join(uploadDir, upload.name);
```

## 良い例

```ts
const usersById: Map<string, User> = new Map();

const filePath = path.join(uploadDir, upload.name);
```
