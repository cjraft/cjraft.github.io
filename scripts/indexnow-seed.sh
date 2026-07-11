#!/usr/bin/env bash
#
# indexnow-seed.sh —— 一次性把全站 URL 批量提交给 IndexNow（Bing/Yandex 等）。
#
# 用途：新站/首次接入时给存量文章「播种」，让 Bing 立刻知道所有已存在页面。
# 平时不用跑——日常新文章由 .github/workflows/hugo.yml 里的 IndexNow 步骤自动增量提交。
# ⚠️ 不要反复对未改动页面重播，那属于滥用，可能降低信任。做一次即可。
#
# 依赖：curl、jq。用法：bash scripts/indexnow-seed.sh
#
set -euo pipefail

HOST="cjraft.github.io"
KEY="c55f95d1b0884f3bbe8bf914a7a7bc32"
SITEMAP="https://${HOST}/sitemap.xml"
ENDPOINT="https://api.indexnow.org/indexnow"

echo "从 sitemap 抽取 URL：$SITEMAP"
URLS=$(curl -sSL "$SITEMAP" | grep -oE '<loc>[^<]+' | sed 's/<loc>//')
COUNT=$(printf '%s\n' "$URLS" | grep -c . || true)
echo "共 ${COUNT} 个 URL，准备提交（单次上限 10000）"

if [ "$COUNT" -eq 0 ]; then
  echo "没有抓到 URL，检查 sitemap 是否可访问。" >&2
  exit 1
fi

BODY=$(jq -n \
  --arg h "$HOST" \
  --arg k "$KEY" \
  --argjson u "$(printf '%s\n' "$URLS" | jq -R . | jq -s .)" \
  '{host:$h, key:$k, keyLocation:("https://"+$h+"/"+$k+".txt"), urlList:$u}')

curl -sS -X POST "$ENDPOINT" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$BODY" -w "\nHTTP %{http_code}\n"

echo
echo "完成。200/202 即被接收；引擎稍后会核对 https://${HOST}/${KEY}.txt 归属。"
