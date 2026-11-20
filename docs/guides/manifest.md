# マニフェストの手引き

プロジェクトのルートの `quality-rules.json`（**マニフェスト**）は、どの**束**を取り入れ、どの**ルール**・**規約**を外し、どんなオプションで使うかを書くファイルです。`quality-rules sync`（**同期**）が、これとパッケージの版から **生成物** をプロジェクトの `quality-rules/` に作ります。生成物は手で直しません。

```json
{
  "packs": ["baseline", "size-limits", "naming"],
  "exclude": ["CMT-7"],
  "include": [],
  "options": { "max-params": 5 },
  "local": { "prefix": "PROJ", "dir": "docs/conventions" },
  "toolchain": "biome-oxlint",
  "resolved": ["..."]
}
```

## 各欄

| 欄 | 内容 |
| --- | --- |
| `packages` | パッケージごとの、増えたものを全部受け入れ終えた（または外した）版。`sync` が書き直す。版上げで増えたものを調べる基準になる。 |
| `packs` | 取り入れる**束**の名前（`quality-rules list` で一覧が出る）。 |
| `exclude` | 外す**ルール**・**規約**の ID。**規約**を外すと、それを受け持つ**ルール**も一緒に外れる。 |
| `include` | 外した**規約**のうち、受け持つ**ルール**だけを改めて入れたいときに、そのルールの ID を書く。**規約**そのものを戻すときは `exclude` から除く。 |
| `options` | **ルール**の ID ごとのオプション。値の形はそのルールの `list --json` の `options` に出る既定値と同じ形。 |
| `resolved` | 有効なものの ID の一覧。**同期**が書く。手で足さない。 |
| `local` | **案件固有**の**規約**。`prefix`（例 `PROJ`）と `dir`（規約のファイルを置くフォルダ）。 |
| `toolchain` | `biome-oxlint`（既定）か `eslint-prettier`。 |

### options の例

- 大きさの上限: `"max-params": 5`、`"max-lines-per-function": 120`、`"max-lines"`、`"max-depth"`。
- 独自ルール: `"quality-rules/no-scientific-literal": { "allowFiles": ["src/domain/tolerance.ts"] }`（`no-range-bound-comparison` も同じ形）。`no-boolean-argument` は許す関数名・名前のパターンを受ける。
- 依存の向き: `dependency-cruiser/layer-order`（`layers` に名前とパスを上から順に）、`dependency-cruiser/closed-modules`（`modules` と `public`）、`dependency-cruiser/no-ui-in-pure-layer`（`layers`）。
- 重複: `jscpd/changed-lines-duplication` の `baseBranch` と `dirs`。
- 単体テスト: `unit-tests/imported-by-tests` の `dirs`・`testDirs`・`tsconfig`。
- 抑止コメント: `quality-rules/no-disable-comments` の `dirs`（`quality-rules suppressions` が読む。既定は `["src"]`）。

形が違うオプションは `sync` と各下位コマンドがエラーで知らせます。

### toolchain

`biome-oxlint` なら biome と oxlint の生成物、`eslint-prettier` なら ESLint の flat config（`eslint.mjs`）と Prettier の設定（`prettier.json`）を作ります。knip と dependency-cruiser の生成物はどちらでも作られます。独自のルールはどちらでも動きます。道具の組を切り替えたあとに残った、もう書かれない側の生成物は消されず、知らされます。

## 版上げと保留中のルール

パッケージの版を上げると、**束**に**ルール**や**規約**が増えることがあります。増えたものは、次の両方に当てはまるときだけ**保留中のルール**になります。

- パッケージに足された版が、`packages` に書いてある版より新しい。
- 前回も選んでいた**束**にある。

初めて選んだ**束**のものと、`packages` にまだ無いパッケージ（初めての `sync`）のものは、そのまま有効になります。保留中のものは有効にならず、lint にも出ません。`sync` と `check` が一覧で知らせます（`check` は知らせるだけで失敗にしません）。

受け入れ方:

```sh
quality-rules sync --accept NAME-3      # 1 本ずつ（繰り返せる）
quality-rules sync --accept-all         # すべて
```

受け入れたものが `resolved` に足されます。受け入れたくないものは `exclude` に書きます。`--accept` に `exclude` にあるものや保留中でないものを指すとエラーです。

あるパッケージの保留中が残る間は、`packages` のそのパッケージの版は版上げの前のまま残り、保留中のものは次の `sync` でも保留中のままです。保留中を全部受け入れるか外すと、次の `sync`（受け入れる `sync` そのものを含む）で、`packages` が入っている版に上がります。

`exclude` から ID を除くと、その ID は次の `sync` ですぐに有効に戻り、保留中にはなりません。**規約**を `exclude` から除くと、それを受け持つ**ルール**も一緒に有効に戻ります。ただし、まだ `packages` の版より新しく足されたもの（保留中のまま外したもの）は、除くと保留中に戻ります。

パッケージから無くなったものは、マニフェストのどこに書いてあっても（`resolved`・`exclude`・`include`・`options`）そこから除かれ、除いたことが欄と一緒に出力されます。

## 案件固有の規約

`local` に `prefix` と `dir` を書くと、`dir` の規約のファイル（`<prefix>-1.md` など）の ID がマニフェストの選択に加わります。次のときは `sync` がエラーで止まります。

- `prefix` が、パッケージの規約の分類名（NAME・GEN・FIX・REUSE・CONCERN・TYPE・CMT・UX・E2E・UNIT・STYLE）と重なる。
- `dir` の規約の ID が、パッケージの規約の ID と重なる。

## quality-rules/ の知らないファイル

`quality-rules/` に、`sync` が書かないファイルがあっても、消しません。残して、一覧で知らせます。

## 規約のファイルの場所

レビューの道具は、`resolved` の ID のうち規約に当たるものを、インストール済みのパッケージの `conventions/<ID>.md`（例 `@reeschan/quality-rules-typescript/conventions/NAME-2.md`）から探します。規約に「機械検査」の欄があり、そのルールが `resolved` にあれば「機械では拾えない残り」だけを見ます。ルールが外れていれば規約の全体を見ます。
