/* tutorial.js — 初回起動時に表示するチュートリアル用の保存例。
 * ChatGPT との実際の要件定義チャット（hisyo × Dots 再設計）を、本流＋分岐レーン・付箋・ToDo の形に整えたもの。
 * ブラウザ(window.Tutorial)と Node(require) の両方で読める。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./model.js')); }
  else { root.Tutorial = factory(root.Model); }
})(typeof self !== 'undefined' ? self : this, function (Model) {
  'use strict';

  const TITLE = 'チュートリアル: hisyo × Dots 再設計の要件定義';
  const NORTH_STAR = '自分がすべてのタスクを把握・指示しなくても、研究・インターン・開発・SNS の複数プロジェクトが着実に前進する状態にする';

  // ---------- 本流 ----------
  const M_REQUEST = `dots（あなた）がリリースされたことで、今まで hisyo でしていた作業の大部分が dots との会話に移り、あまり使っていないのが現状です。

hisyo の機能と dots の得意分野を比較分析し、タスクや定期タスクを **研究やインターンなどの分野の違い・プロジェクトの違い・日付** などから確認できる UI やデータベースを作成したいので、以下の手順で開発の要件定義を手伝って。

手順は下記の記事の手順で。

> （ここに記事「How to be more ambitious: A tutorial for humans with models」— Felix Rieseberg, 2026/10/13 — の本文を貼り付けた）
>
> 要点: AI 活用の野心を 4 種類で考える。
> - **Speed** … 同じ作業をより短時間で
> - **Altitude** … 抽象度を上げ、個々のタスクではなく「その先の結果」を問う
> - **Depth** … 一流の専門家の道具・生データ・外部の審判を使って深くやる
> - **Range** … 普段使わない分野の知識や手法を持ち込む`;

  const M_V01 = `# hisyo × Dots 再設計プロジェクト
要件定義 v0.1 ｜ 2026年10月20日

今回の開発では、hisyo を従来の秘書 AI として維持するのではなく、**Dots と連携する「個人活動の統合管理基盤」へ再設計する**ことを第一候補として提案します。

hisyo の GitHub リポジトリの README と .company/CLAUDE.md、研究の締切管理ファイルを確認しました。現状の hisyo はタスク管理、相談、アイデアの記録、週次レビュー、専門部署への振り分けなど多くの機能を持っていますが、Dots の登場によって自然言語での相談やタスクの依頼といった役割が重複し始めています。

記事に沿って、次の順序で進めます。

1. **Phase 1 — Altitude**：何を達成したいか（今回の中心）
2. **Phase 2 — Depth**：データモデル、定期タスクの実行履歴、システム間同期、UI、品質検証まで掘り下げる
3. **Phase 3 — Range**：PM、データエンジニアリング、AI エージェント、UX、業務自動化の手法を組み合わせる
4. **Phase 4 — 要件定義の確定**：PRD、機能要件、非機能要件、DB 設計、MVP 開発計画

## 1. 現行 hisyo と Dots の役割比較

| 機能 | hisyo | Dots | 今後の方向性 |
|---|---|---|---|
| 自然言語での相談 | Claude Code で対応 | 得意 | Dots 中心 |
| タスクの追加・修正 | Markdown に記録 | 会話から依頼可能 | 共通 DB に集約 |
| タスク一覧の俯瞰 | Markdown／ローカルダッシュボード | 会話型の確認 | 専用 UI |
| 長期的なプロジェクト管理 | フォルダごとに現在地を保持 | 継続的な文脈理解が得意 | 役割分担 |
| 定期タスクの実行 | 外部ワークフローなどと連携 | 継続的な作業を委任可能 | 実行主体を整理 |
| 実行履歴の蓄積・集計 | ファイル中心 | 会話・作業結果中心 | DB で構造化 |
| 研究・SNS・開発の分離 | 部署別ディレクトリ | 会話から横断して扱う | UI で分類 |
| GitHub による履歴管理 | 得意 | 連携次第 | 継続活用 |

Dots にどのデータを直接読み書きさせられるか、どの定期作業を Dots 自身が担えるかは、実際の接続・操作手段によって異なります。共通 DB との双方向同期がすでに実現できる前提では設計しません。

### 現行 hisyo で残すべき資産
- **secretary**：タスク、意思決定、アイデアの管理
- **research**：研究の締切と実験・解析の現在地を分離
- **marketing**：インターン業務の進行管理
- **affiliate**：個人 SNS をインターンと分離
- **engineering**：アプリごとの設計・開発状況
- **line-routine**：LINE 通知の設定と実行基盤

業務分類と履歴は引き継ぎ、会話窓口やタスク登録処理を再設計するのが合理的です。研究については、hisyo が締切のみを保持し実験・解析の詳細は研究側で管理する既存の責任分離を維持した方が安全です。

## 2. Altitude：タスク管理の一段上にある目的

| 段階 | 内容 |
|---|---|
| LEVEL 1 — 現在の要望 | 分野・プロジェクト・日付別にタスクを見られる UI |
| LEVEL 2 — その先の目的 | 何を、いつ、どの順序で進めるべきか迷わない |
| LEVEL 3 — 提案する最終目標 | 複数の活動を AI と協働しながら継続的に前進させ、本人は重要な意思決定と創造的な仕事に集中する |

**理想的な 1 日の流れ（仮説）**
1. 朝、研究・インターン・開発などの予定と期限を自動で集約する
2. AI が今日取り組むべき優先事項とその根拠を提示する
3. 定型業務は Dots などのエージェントが実行し、結果を記録する
4. ユーザーは UI で全体像を確認し、必要な部分だけ判断する
5. 完了・遅延・問題発生がプロジェクトの進捗に反映される

目指すのは、タスクを人間が管理するシステムから、**AI が活動の進行を支援するシステム**への移行です。

## 3. 新システムの構成案

| 担当 | 役割 |
|---|---|
| Dots | 会話・状況判断・調査・タスク実行 |
| 共通データベース | タスク・プロジェクト・定期実行設定・実行履歴 |
| 管理 UI | 一覧・分析・操作 |
| 外部実行基盤 | GitHub Actions など |

Dots が持つタスク情報を外部 DB へ自動同期する公開 API は、今回確認した資料だけでは保証できません。

## 4. 管理 UI の初期イメージ（モック）

| タスク | 分野 / プロジェクト | 期限 | 状態 |
|---|---|---|---|
| 論文の章構成を確定 | 研究 / 論文 | 10/31 | 未着手 |
| 数値の凍結と評価 | 研究 / 論文 | 11/07 | 未着手 |
| 投稿内容を確認 | インターン / 広報案件 | 未設定 | 要確認 |
| AIニュース原稿の生成 | 個人SNS / morning-agent | 平日 | 定期 |

| データ | 主な項目 |
|---|---|
| 分野 | 研究、インターン、個人開発など |
| プロジェクト | 名称、目的、状態、期限 |
| タスク | 担当、優先度、期限、進捗、所属 |
| 定期タスク | 実行頻度、実行主体、次回予定 |
| 実行履歴 | 実行日時、成功・失敗、成果物 |
| 意思決定 | 決定内容、根拠、関連プロジェクト |

特に重要なのは、**「定期タスクの定義」と「実際の実行履歴」を別々に管理する**ことです。毎朝 7 時に実行するタスクが登録されている事実と、今朝 7 時に本当に成功した事実は異なります。

## 5. Altitude で最初に決めたいこと

このシステムの最終目的として、最も近いものはどれですか？

- **A. 情報を一元管理したい** — タスクやプロジェクトの状態を正確に把握できることを最優先。AI は主に入力を助ける
- **B. 毎日の行動を最適化したい** — 優先順位や時間配分を AI が提案し、判断の負担を減らす
- **C. AI による自律的な進行管理を実現したい** — AI が進捗を追い、実行可能な作業を進め、問題や判断事項だけを自分に届ける

暫定推奨は **C を長期目標に設定し、A を最初の MVP として実装する**ことです。次は「完成したとき、今の生活・作業の何が変わっていれば成功なのか」を掘り下げます。`;

  // ---------- 分岐: Phase 1 Altitude ----------
  const M_PICK_C = `最終目的は **C の AI による自律的な進行管理** です。

この方向で Altitude をさらに掘り下げ、成果指標、人間と AI の責任分担、理想の 1 日を具体化してください。`;

  const M_V02 = `# Phase 1 — Altitude：AI による自律的な進行管理
要件定義 v0.2 ｜ 2026年10月20日

「AI がタスクを自動実行する」ことと「AI がプロジェクトの進行を自律的に管理する」ことを区別します。前者は作業の自動化、後者は**目的から逆算して必要な仕事を発見し、実行し、結果を検証し、次の行動につなげる仕組み**です。今回は後者を目指します。

## 1. 最終的に実現したい状態

> **NORTH STAR** — 自分がすべてのタスクを把握・指示しなくても、複数のプロジェクトが着実に前進する。

| 段階 | 目指す状態 |
|---|---|
| Level 1：可視化 | すべてのタスクと進捗が一目でわかる |
| Level 2：進行支援 | AI が次にやるべきこと、遅延、優先順位を判断する |
| Level 3：自律的な進行管理 | AI が仕事の発見・実行・検証・再計画を継続的に行う |

ただし、自律性は無制限に高めるのではなく、作業ごとに権限と承認条件を定義します。

## 2. 成果指標

| 区分 | 指標 | 初期目標 |
|---|---|---|
| 最重要 | 定型的な進行管理操作の削減率 | 70%以上 |
| 補助 | 重要タスクの期限前検知率 | 90%以上 |
| 品質 | 自動実行の正常完了率 | 95%以上 |
| 安全性 | 未承認の高リスク操作 | 0件 |

※ 現時点の実績ではなく初期目標案。運用開始前に現状を 2 週間程度計測して調整します。

| 指標 | 測定方法 |
|---|---|
| 管理負担削減率 | タスク整理、進捗確認、催促、状況報告に費やす時間・操作回数の前後比較 |
| 期限前検知率 | 重要な期限のうち、設定したリードタイム内に AI が検知できた割合 |
| 自動実行成功率 | 品質チェックを通過して正常完了した割合 |
| 手戻り率 | AI 完了案件のうち、本人が修正・再実行した割合 |
| プロジェクト前進率 | 予定マイルストーンに対する実際の達成状況 |
| AI 提案採用率 | 提案された行動のうち本人が採用した割合 |

「AI が完了と言った回数」ではなく、**実際の成果物や外部システムの状態で完了を検証する**ことを重視します。

## 3. 人間と AI の責任分担

基本方針は、AI が実務の進行を担当し、人間が目的・価値判断・最終責任を持つことです。

**自律性の 5 段階**: 0 記録 → 1 提案 → 2 承認付き実行 → 3 制限付き自律実行 → 4 目標駆動型の自律管理

| 業務 | AI の担当範囲 | 人間の責任 |
|---|---|---|
| 研究 | 論文調査、実験ログ整理、解析結果の収集、進捗管理 | 研究方針、科学的妥当性、結果の解釈 |
| インターン | 投稿案作成、進行状況確認、報告資料作成 | 品質確認、対外公開の承認 |
| 個人開発 | Issue 整理、実装、テスト、PR 準備 | 仕様の決定、重要な変更の承認 |
| SNS | ネタ調査、下書き、投稿効果の分析 | 発信方針、公開可否の判断 |
| 日常・予定 | 予定の統合、期限検知、日程候補の提案 | 優先順位の最終調整 |

AI が自動実行してよいのは、事前に許可した**低リスク・可逆的な操作だけ**。外部への送信・投稿、本番環境の変更、データ削除、費用が発生する操作は承認ルールを設けます。

## 4. 理想の 1 日（動作イメージ）

- **前夜〜早朝**：カレンダー、各プロジェクトのタスク、GitHub の Issue、承認待ち、定期実行結果を照合し、翌日の優先候補を準備
- **朝 7:00〜8:00**：Daily Brief が届く（例：「今日の最優先は研究の解析結果の確認です」）
- **午前〜午後**：本人が解析や実験に集中している間、AI は許可された定型業務・資料整理・開発支援を進める
- **判断が必要なときだけ**：AI が選択肢と判断材料を提示（通知は期限・影響度・緊急性でまとめる）
- **夜**：完了・未完了の原因・AI の実行結果・次のアクションを記録し、差が大きければ再計画案を生成

## 5. Altitude から導かれるシステム要件

| 必要な仕組み | 理由 | 優先度 |
|---|---|---|
| プロジェクト・タスク DB | AI と UI が共通の状態を参照するため | P0 |
| 分野・プロジェクト・期限別 UI | 人間が活動全体を監督するため | P0 |
| 定期タスクと実行ログ | 予定された処理が実際に完了したか確認するため | P0 |
| 外部ツール連携 | GitHub や予定などから最新状態を取得するため | P0 |
| 承認・実行権限管理 | AI の自律実行を安全にするため | P0 |
| 進捗検知・優先順位付け | 指示される前に問題を発見するため | P1 |
| 目標からのタスク自動生成 | 作業の発見まで AI に任せるため | P2 |
| 成果予測・リソース最適化 | プロジェクト横断で時間配分を改善するため | P2 |

中心に置くデータは **目標 → プロジェクト → マイルストーン → タスク → 実行・検証** の階層です。

## 6. 理想の管理スタイルは？

- **A. 監督型** — 毎日ダッシュボードで全体を確認し、積極的に関与したい
- **B. 例外対応型** — 基本は AI に任せ、問題・承認・重要な意思決定のときだけ対応
- **C. ハイブリッド型** — 朝や週末は自分で全体を確認して方針を決め、それ以外は AI に任せて重要な問題だけ通知

推奨は **C のハイブリッド型** です。`;

  const M_PICK_HYBRID = `理想の管理スタイルは **C のハイブリッド型** です。

これを前提に Altitude の要件を確定し、次の Depth フェーズへ進めてください。`;

  const M_V03 = `# hisyo × Dots 再設計 — Altitude 確定・Depth 設計
要件定義 v0.3 ｜ 2026年10月21日

> 人間は定期的に目標と優先順位を決定する。AI はその方針に沿って日々の状況を把握し、タスクの発見・実行・検証・再計画を行う。重要な判断や例外だけを人間に届ける。

## Part 1. Altitude — 要件確定

仮称は **Activity OS**。hisyo や Dots に代わる新しい会話 AI ではなく、活動状況を構造化し、AI と人間が共通の情報で進行管理するための基盤です。

| 役割 | 担当 |
|---|---|
| Human | 目標・優先順位・承認・価値判断 |
| Dots / AI | 情報収集・タスク提案・実行・進捗評価 |
| Activity OS | 状態・予定・成果物・履歴を一元管理 |

| 項目 | 確定方針 |
|---|---|
| 最終目的 | AI による自律的な進行管理 |
| 人間の関与 | ハイブリッド型 |
| 日次運用 | 朝のブリーフィング＋例外時の通知 |
| 週次運用 | 方針・優先順位・進捗のレビュー |
| UI の役割 | 全体監督、詳細確認、承認、履歴閲覧 |
| 自律性の制限 | リスクと権限に応じた実行制御 |

**最初の 30 日間の KPI（初期の受け入れ目標）**

| KPI | 初期目標 | 検証方法 |
|---|---|---|
| 進行管理に費やす時間 | 50%削減 | 導入前後の週平均時間 |
| 重要期限の事前検知率 | 90%以上 | 期限台帳と通知ログの突合 |
| 定期タスク実行成功率 | 95%以上 | 検証済み実行ログ |
| 活動データの整合性 | 99%以上 | 外部データとのサンプル照合 |
| 無許可の高リスク操作 | 0件 | 操作・承認ログ |
| 週次レビューの実施率 | 100% | レビュー記録 |

最終的な成功判定は「管理時間の短縮」だけではなく、**その分、研究・開発などの本来の成果が向上したか**で行います。

## Part 2. Depth — 専門家レベルの設計

| 問い | 回答 |
|---|---|
| 一流の専門家なら何をするか | UI を作る前に、業務イベント、状態遷移、権限、障害時の復旧を設計する |
| 最も生のデータは何か | タスク Markdown、GitHub Issue、予定、メッセージ、ワークフロー実行ログ、成果物 |
| 使用すべき技術・手法 | 正規化 DB、イベントログ、状態機械、スケジューラ、API 連携、承認制御、可観測性 |
| 正しさを何で検証するか | 外部サービスの実状態、テスト、実行証跡、本人による成果判定 |

### データ構造
Area（分野）→ Project → Milestone → Task、加えて Recurring Job / Execution / Approval / Event。目標は複数プロジェクトにまたがるため別テーブルで関連付けます。

| テーブル | 主要なフィールド |
|---|---|
| areas | id, name, sort_order |
| goals | id, title, target_date, success_criteria |
| projects | id, area_id, name, status, target_date |
| project_goals | project_id, goal_id |
| milestones | id, project_id, title, due_at |
| tasks | id, project_id, milestone_id, title, status, due_at, owner_type |
| task_dependencies | task_id, depends_on_task_id |
| recurring_jobs | id, project_id, schedule, timezone, executor, enabled |
| job_runs | id, job_id, scheduled_at, started_at, finished_at, status |
| approvals | id, action_id, decision, decided_at |
| events | id, entity_type, entity_id, source, timestamp, payload |
| external_links | entity_id, provider, external_id, sync_status |

設計上の工夫: **tasks と recurring_jobs を分離**／**job_runs で「登録」と「成功」を区別**／**events と external_links で変更の根拠と外部対応を追跡**。時刻は DB 内部で UTC、UI では日本時間。

### 状態管理と AI の実行モデル
タスクの状態はシンプルに（未着手 → 進行中 → 完了）。AI の実行状態は別管理（実行待ち → 実行中 → 検証中 → 正常完了。承認待ち・再試行待ち・失敗・キャンセル・中断へ分岐）。**検証に通過して初めて正常完了**とします。

自律実行の基本ループ: **Observe → Decide → Authorize → Execute → Verify → Replan**。スケジュール・外部イベント・状態変更を契機に起動し、回数・時間・予算の制限、重複実行防止、停止方法を持たせます。

### Dots と外部実行基盤の接続

| 層 | 担当 | 設計方針 |
|---|---|---|
| AI 作業層 | Dots、Codex など | 調査・生成・実装・判断支援 |
| 制御・記録層 | Activity OS | タスク状態、承認、期限、履歴の正本 |

外部連携は Adapter（GitHub / Google Calendar / Dots）として抽象化し、Dots の機能変更があっても DB と UI を作り直さずに済むようにします。

### 管理 UI（AI の進行管理を監督するコックピット）
1. **Overview** — 今日の優先事項、期限超過、承認待ち、AI が実行中の作業、今週の進捗
2. **Projects** — 分野・プロジェクトごとのタスクとマイルストーン
3. **Calendar & Routines** — 期限と定期タスクを日・週・月で。次回実行・前回成功・失敗履歴
4. **Agent Activity** — AI の判断、実行内容、成果物、エラー、承認待ちを時系列で

共通フィルター: 分野、プロジェクト、担当（人間/AI）、状態、日付。

### 技術構成の暫定推奨

| 領域 | 推奨候補 |
|---|---|
| フロントエンド | Next.js + TypeScript |
| データベース | PostgreSQL（Supabase） |
| スケジューラ | GitHub Actions / 外部 Cron |
| AI 処理 | Dots / Codex / API |
| 外部連携 | 各サービスの API・Webhook |
| 監視・ログ | 構造化ログ＋実行履歴 DB |

### 開発の順序
- **MVP 1** タスクの正本を作る
- **MVP 2** 自動同期と進捗検知
- **MVP 3** 承認付き AI 実行
- **MVP 4** 目標駆動型の進行管理

### 検証すべきケース（抜粋）
- 同じタスクが GitHub と hisyo にあっても二重登録・二重実行しない
- スケジュール済み処理が失敗した場合、正常完了として表示しない
- AI が完了と報告しても、成果物がなければ完了扱いにしない
- 承認が必要な操作を AI が独断で実行できない

## AI 実行基盤をどこに置くか

- **A. Dots 中心** — Activity OS は管理 UI と記録に集中
- **B. ハイブリッド構成（推奨）** — Dots は対話・複雑な仕事、Activity OS 側で定期処理・DB・承認・実行ログを管理
- **C. 独立した AI エージェント基盤** — 自由度は高いが開発・運用の負担が増える`;

  // ---------- 分岐: Phase 2 Depth ----------
  const M_PICK_B = `Depth のアーキテクチャは **B のハイブリッド構成** を採用します。

この構成を前提に、既存 hisyo の移行計画、ER 図、同期方式、API 設計、定期タスクの仕様を具体化してください。`;

  const M_V04 = `# Activity OS — 技術要件定義・詳細設計 v0.4
2026年10月21日 ｜ Depth フェーズ ｜ hisyo × Dots ハイブリッド構成

結論として、**hisyo を全面的に作り直す必要はありません**。既存の専門知識・業務ルール・履歴を維持しながら、タスクと定期実行の状態管理だけを Activity OS へ段階的に移行します。

重要な発見:
1. hisyo には、Dots との依頼・納品を GitHub 経由でやり取りする **dots-seed** の設計が既に存在する
2. 朝 6:30 の予定通知、平日 7:00 の AI ニュース下書き、朝夕の X 監視など、定期実行仕様が **line-routine/routines.md** に定義済み
3. 研究の進捗は研究側、期限は hisyo に分離されている。この責任境界は新システムでも維持する

> **設計上の不変条件**：Activity OS は進行管理状態の正本、GitHub はソースコード・業務ルール・ドキュメントの正本、各外部サービスは自身の実データの正本。

## 1. 既存 hisyo の移行計画

| 既存領域 | 新システムでの扱い | 方針 |
|---|---|---|
| secretary/todos/ | DB 移行 | 日次 Markdown をタスクレコードに変換 |
| secretary/inbox/ | DB＋履歴保持 | 未整理情報を Inbox に取り込み |
| secretary/notes/ | 参照中心 | 決定事項は構造化、原文は GitHub に保持 |
| research/deadlines.md | DB 同期 | 締切を取り込み、研究本体は読み取り専用 |
| marketing/content-plan/ | 段階的 DB 移行 | 投稿単位のタスク・工程を構造化 |
| affiliate/ | 一部 DB 移行 | 投稿予定・実績を移し、運用ノウハウは保持 |
| engineering/products/ | 参照連携 | 製品概要・計画・意思決定は GitHub に保持 |
| chatgpt/dots-seed/ | 連携アダプターへ発展 | 依頼・納品プロトコルを再利用 |
| line-routine/ | 定期実行レジストリに登録 | 設定と既存ワークフローを保持 |
| .claude/skills/ | 維持 | 実行可能な業務知識として再利用 |

「移行」は元ファイルを削除することではなく、まず読み取り・照合し、新しい DB に対応レコードを作ることです。移行期間中は、既存の LINE 通知のために **DB から従来形式の Markdown を出力する互換レイヤー**を用意します。

研究の実験数値・解析結果・未公開データを無条件に Dots へ送る設計にはしません。匿名化・機密情報除外のルールは技術的なアクセス制御として実装します。

### 段階的なデータ移行
- **M0** 資産の棚卸しとバックアップ（source_system / source_path / source_revision を付与）
- **M1** DB への試験取り込み（曖昧なデータは needs_review で保留）
- **M2** 読み取り専用ダッシュボード（既存の実行方式は変更しない）
- **M3** 書き込みの切り替え（正本を Activity OS に、互換 Markdown を生成）
- **M4** 自律実行の統合（委任・承認・実行ログ・検証・再計画）

## 2. ER 図（論理設計の要約）

| 区分 | エンティティ |
|---|---|
| Management | AREAS, GOALS, PROJECTS, PROJECT_GOALS, MILESTONES, TASKS, TASK_DEPENDENCIES |
| Automation | RECURRING_JOBS, JOB_RUNS, EXECUTIONS, APPROVALS |
| Integration | INTEGRATIONS, EXTERNAL_LINKS, SYNC_CURSORS |
| Audit | ARTIFACTS, EVENTS |

主な関係: AREA → PROJECT → MILESTONE → TASK、RECURRING_JOB → JOB_RUN → EXECUTION → APPROVAL / ARTIFACT、INTEGRATION → EXTERNAL_LINK / SYNC_CURSOR。

### tasks テーブル

| カラム | 型 | 用途 |
|---|---|---|
| id | UUID | 内部識別子 |
| project_id | UUID | 所属プロジェクト |
| title / description | TEXT | タスク名・完了条件 |
| status | ENUM 相当 | inbox / ready / in_progress / blocked / done / canceled |
| priority | ENUM 相当 | urgent / high / normal / low |
| owner_type | TEXT | human / ai / external |
| scheduled_at / due_at | TIMESTAMPTZ | 着手予定・期限 |
| completed_at | TIMESTAMPTZ | 完了日時 |
| version | INTEGER | 競合更新防止 |

期限が日付のみの場合は due_date を別に設け、指定していない時刻を勝手に 23:59 などに変換しません。

### recurring_jobs テーブル
name, schedule_type（cron / interval / manual / event）, schedule_expression, timezone, calendar_policy, executor_type（github_actions / dots / api_worker）, external_workflow_id, retry_policy, timeout_seconds, approval_policy_id, enabled, version。job_runs は発火予定時刻ごとに 1 件、再試行は executions で追跡します。

## 3. 同期方式

| データ | 正本 | 他システムの権限 |
|---|---|---|
| タスクの優先度・状態 | Activity OS | API 経由で変更 |
| 研究の実験・解析内容 | 研究側 | 原則読み取りのみ |
| Google カレンダーの予定 | Google Calendar | 同期・承認付き更新 |
| GitHub Issue・PR | GitHub | 状態取得、許可された操作 |
| 業務ルール・プロンプト | GitHub | バージョン管理 |
| 定期実行設定 | Activity OS（移行後） | 実行基盤へ反映 |
| 実際の実行成否 | 実行元の証跡 | Activity OS へ集約 |
| Dots の内部タスク | Dots | 連携方法を要検証 |

流れ: Webhook / Polling で受信 → イベント保存 → 正規化・重複排除 → 正本・版数・権限が適合すれば DB に反映、競合なら保留して人間に判断を依頼。Activity OS からの操作は Outbox に記録 → 外部 API へ送信 → 結果照合。

衝突ルール: 「最後に更新したものが勝つ」は使わない。provider + external_id で一意識別、version / ETag で楽観的排他、event_id で重複排除、Outbox パターンで再送可能に。

## 4. API 設計（REST, /api/v1）

| Method | Endpoint | 目的 |
|---|---|---|
| GET | /areas | 分野一覧 |
| GET / POST | /projects | プロジェクト一覧・作成 |
| GET / POST | /tasks | タスク検索・作成 |
| PATCH | /tasks/{id} | タスク更新 |
| GET / POST | /recurring-jobs | 定期処理一覧・登録 |
| GET | /job-runs | 定期処理の履歴 |
| POST | /job-runs/{id}/retry | 再実行依頼 |
| POST | /executions | AI・ワーカーへの作業投入 |
| POST | /approvals/{id}/decision | 承認・却下 |
| GET | /events | 変更・操作履歴 |
| GET | /dashboard | 統合ダッシュボード |

~~~json
{
  "project_id": "project-uuid",
  "title": "論文の章構成を確定する",
  "priority": "high",
  "status": "ready",
  "owner_type": "human",
  "due_date": "2026-10-31",
  "source": { "provider": "hisyo", "path": ".company/research/deadlines.md" }
}
~~~

更新時は If-Match でバージョンを指定し、一致しなければ 412 Precondition Failed。AI には /agent/proposals, /agent/execution-requests, /agent/executions/{id}/results, /agent/context, /agent/policies の**制限付き API**だけを渡し、承認確認は API 側で強制します。

## 5. 定期タスクの仕様

| 処理名 | スケジュール | 実行基盤 |
|---|---|---|
| 朝の予定・秘書メモ | 毎日 6:30 | morning-agent |
| AI ニュース下書き | 平日 7:00 | morning-agent |
| X 見逃し注意 | 毎日 7:00 / 18:00 | morning-agent |
| 週次レビュー | 金曜日・時刻未確定 | hisyo / 将来移行 |

3 つの概念に分ける: **Job Definition**（何をいつどこで）／**Scheduled Run**（1 回分の予定枠）／**Execution Attempt**（その枠への個々の試行）。

~~~yaml
id: morning-briefing
name: 朝の予定と秘書メモ
timezone: Asia/Tokyo
schedule:
  type: cron
  expression: "30 6 * * *"
  misfire_policy: run_if_within_grace
  grace_minutes: 30
executor:
  type: github_actions
  repository: harutpo/morning-agent
  workflow: morning_schedule.yml
runtime:
  timeout_seconds: 600
  max_attempts: 3
  retry_backoff_seconds: [60, 300]
  concurrency: forbid
verification:
  type: external_delivery
  require_delivery_evidence: true
~~~

| ケース | システムの動作 |
|---|---|
| GitHub Actions が起動しない | 予定枠が未実行のまま残り、猶予時間後に検知 |
| AI API がエラー | 再試行可能なエラーのみバックオフして再試行 |
| LINE 送信に失敗 | 送信結果を照合し、重複送信を避ける |
| 品質チェック失敗 | verification_failed として保存 |
| 外部 API がタイムアウト | 状態不明として照会。安易に再実行しない |
| 月額 API 上限に到達 | 一時停止し、コスト超過を防止 |

## 6. Dots 連携

既存の requests/ と deliveries/ の仕組みを使い、まず **GitHub ベースの非同期通信**で始めます（ユーザーが委任承認 → Activity OS が依頼ファイル作成 → Dots が作業して納品ファイル作成 → Activity OS が成果物を検証して表示）。結果が得られないときは stale / unknown に移行します。

セキュリティ必須要件: プロジェクト単位のアクセス権限、Dots へ渡す情報の Allowlist、最小権限トークン、機密データの混入検査、監査ログ、緊急停止手順。**Dots に直接書き込み権限を渡さない従来の制限は、自動的には解除しません。**

## 7. 初期バックログ
1. PostgreSQL スキーマを作成
2. hisyo Markdown 取り込み
3. 管理 UI（Overview / Projects / Calendar / Agent Activity）
4. GitHub 連携
5. 定期実行レジストリ
6. Dots 受け渡し
7. AI による進行管理

## 8. 次は Phase 3 — Range
PM、ワークフローエンジン、イベントソーシング、AI エージェントの安全性、HCI・UX の 5 つの観点で検証します。「そもそも人間がタスク一覧を見続ける必要があるのか」「AI に目標だけ渡して進行を任せるには何が不足しているか」から見直す価値があります。`;

  /** チュートリアル用プロジェクトを毎回新しく組み立てる（ID は都度生成）。 */
  function build() {
    const p = Model.createProject(TITLE);
    p.northStar = NORTH_STAR;

    const mReq = Model.addMessage(p, 'root', 'user', M_REQUEST);
    const sGuide = Model.addSticky(p, mReq, 'これはチュートリアル用の保存例です（ChatGPT との要件定義チャットを貼り付けたもの）。\n右のレーンが分岐、色は 4 軸のタグ。「新規」を押すと自分のプロジェクトを始められます。');
    Model.addTodo(p, mReq, sGuide.id, '吹き出しの ⑂ で分岐を作ってみる');
    Model.addTodo(p, mReq, sGuide.id, '📝 で付箋を貼り、+ ToDo でやることを書く');
    Model.addTodo(p, mReq, sGuide.id, 'Ctrl+S でファイルに保存してみる');

    const mV01 = Model.addMessage(p, 'root', 'ai', M_V01);
    Model.addSticky(p, mV01, '分岐のコツ: AI が選択肢（A/B/C）を出したところで ⑂ 分岐すると、どれを選んだかと、その後の流れを横並びで残せる');

    // Phase 1: Altitude
    const lAlt = Model.addLane(p, mV01, 'Phase 1 Altitude: 自律的な進行管理', 'altitude');
    Model.addMessage(p, lAlt, 'user', M_PICK_C);
    const mV02 = Model.addMessage(p, lAlt, 'ai', M_V02);
    Model.addSticky(p, mV02, '決定: 最終目的は C（AI による自律的な進行管理）。MVP はまず情報の一元管理から');
    Model.addMessage(p, lAlt, 'user', M_PICK_HYBRID);
    const mV03 = Model.addMessage(p, lAlt, 'ai', M_V03);
    Model.addSticky(p, mV03, '決定: 管理スタイルはハイブリッド型（朝・週末に自分で方針確認、それ以外は AI、重要な問題だけ通知）');

    // Phase 2: Depth
    const lDepth = Model.addLane(p, mV03, 'Phase 2 Depth: 移行計画・ER図・API', 'depth');
    Model.addMessage(p, lDepth, 'user', M_PICK_B);
    const mV04 = Model.addMessage(p, lDepth, 'ai', M_V04);
    const sNext = Model.addSticky(p, mV04, '決定: B のハイブリッド構成（Dots＝AI 作業層、Activity OS＝制御・記録層）。技術検証で確かめること');
    Model.addTodo(p, mV04, sNext.id, 'Dots が GitHub へ書き込めるか（dots-seed の往復）を検証');
    Model.addTodo(p, mV04, sNext.id, 'morning-agent の最新実行履歴と routines.md を突合');
    Model.addTodo(p, mV04, sNext.id, 'Phase 3 Range に進む');

    // Phase 3: Range（次に貼る場所）
    Model.addLane(p, mV04, 'Phase 3 Range（次はここに貼る）', 'range');

    return p;
  }

  return { TITLE: TITLE, build: build };
});
