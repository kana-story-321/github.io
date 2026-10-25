#!/usr/bin/env bash
# src/ のファイルを1つにまとめて dist/コード.gs を作る
# claspを使わず、Apps Script のエディタに貼り付けて入れるとき用（GASは全ファイルが同じ場所で動くので、1つにまとめても同じ）
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
{
  echo "// このファイルは tools/bundle.sh で src/ から作ったものです。直接書き換えず、src/ を直してから作り直してください。"
  echo "// 版：$(sed -n "s/^const APP_VERSION = '\(.*\)';/\1/p" src/00_config.js)"
  for f in src/*.js; do
    echo
    echo "// ===== ${f#src/} ====="
    cat "$f"
  done
} > dist/コード.gs
cp src/appsscript.json dist/appsscript.json
echo "dist/コード.gs と dist/appsscript.json を作りました。"
