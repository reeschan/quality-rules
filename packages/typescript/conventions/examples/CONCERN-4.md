## 悪い例

```ts
// 1 つの関数が、読み込み・集計・書式づけの 3 つの役割を持っている。
async function buildReport(path: string): Promise<string> {
  const rows = parseCsv(await readFile(path, 'utf8'));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return `件数 ${rows.length} / 合計 ${total.toLocaleString()}`;
}
```

## 良い例

```ts
// 役割ごとに関数を分け、それぞれの変わる理由を 1 つにする。
async function loadRows(path: string): Promise<Row[]> {
  return parseCsv(await readFile(path, 'utf8'));
}

function summarize(rows: Row[]): Summary {
  return { count: rows.length, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}

function formatSummary(summary: Summary): string {
  return `件数 ${summary.count} / 合計 ${summary.total.toLocaleString()}`;
}
```
