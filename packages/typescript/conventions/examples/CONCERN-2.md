## 悪い例

```ts
// 「検証、保存、通知」の順が、2 つの入口に写されている。
async function createFromForm(input: Input) {
  validate(input);
  await save(input);
  await notify(input);
}

async function createFromFile(input: Input) {
  validate(input);
  await save(input);
  await notify(input);
}
```

## 良い例

```ts
// 順の段取りは 1 か所に書き、入口はそこを呼ぶだけにする。
async function create(input: Input) {
  validate(input);
  await save(input);
  await notify(input);
}

const createFromForm = create;
const createFromFile = create;
```
