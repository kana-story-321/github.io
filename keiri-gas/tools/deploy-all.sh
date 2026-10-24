#!/usr/bin/env bash
# お客様のGASに、同じコードをまとめて配る（お客様の操作は不要）
#
# 使い方（keiri-gas フォルダで実行）
#   tools/deploy-all.sh --group test             テスト用だけに配る（最初に必ずここで確かめる）
#   tools/deploy-all.sh --group pilot            先行して使ってもらうお客様だけに配る
#   tools/deploy-all.sh                          全員に配る
#   tools/deploy-all.sh --only 山田デザイン事務所   1人だけに配る
#   tools/deploy-all.sh --stop 山田デザイン事務所   解約したお客様に「契約終了版」を配る（ウェブアプリも置き換える）
#   --redeploy-webapp を付けると、LINE受付のウェブアプリも公開し直す（doPost を変えたときだけ。README の「本番前に試すこと」を確認してから）
#
# 準備
#   - customers.json（customers.example.json をまねて作る。リポジトリには入れない）
#   - 弊社の保守用アカウントで `npx @google/clasp@2.4.2 login` 済み
#   - https://script.google.com/home/usersettings で「Google Apps Script API」をオン
#   - 各お客様の管理シートを、保守用アカウントに「編集者」で共有してもらっている
set -euo pipefail
cd "$(dirname "$0")/.."

CLASP="npx --yes @google/clasp@2.4.2"
LIST="customers.json"
ONLY="" GROUP="" STOP="" REDEPLOY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --group) GROUP="$2"; shift 2 ;;
    --stop) STOP="$2"; shift 2 ;;
    --redeploy-webapp) REDEPLOY=1; shift ;;
    *) echo "知らない指定です: $1" >&2; exit 1 ;;
  esac
done

command -v jq >/dev/null || { echo "jq が必要です" >&2; exit 1; }
[ -f "$LIST" ] || { echo "$LIST がありません（customers.example.json をまねて作ってください）" >&2; exit 1; }
VERSION=$(sed -n "s/^const APP_VERSION = '\(.*\)';/\1/p" src/00_config.js)

ROOT="src"
if [ -n "$STOP" ]; then ROOT="stop"; ONLY="$STOP"; fi

trap 'rm -f .clasp.json' EXIT
count=0
while IFS=$'\x1f' read -r name group scriptId deploymentId; do
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  [ -n "$GROUP" ] && [ "$group" != "$GROUP" ] && continue
  if [ -z "$scriptId" ]; then echo "スキップ（スクリプトIDなし）: $name"; continue; fi
  echo "== $name（$ROOT・v$VERSION）"
  printf '{"scriptId":"%s","rootDir":"%s"}\n' "$scriptId" "$ROOT" > .clasp.json
  $CLASP push --force < /dev/null
  # 契約終了版は、LINEの受付（ウェブアプリ）も必ず置き換える（古い受付が写真を受け取り続けないように）
  if [ -n "$deploymentId" ] && { [ "$REDEPLOY" = 1 ] || [ "$ROOT" = "stop" ]; }; then
    $CLASP deploy --deploymentId "$deploymentId" --description "v$VERSION" < /dev/null
  fi
  count=$((count + 1))
done < <(jq -r '.[] | [.name, (.group // ""), (.scriptId // ""), (.deploymentId // "")] | join("\u001f")' "$LIST")

echo "完了：${count}件に配りました。"
[ "$count" -gt 0 ] || { echo "対象のお客様がいません（--only / --group の指定を確認してください）" >&2; exit 1; }
