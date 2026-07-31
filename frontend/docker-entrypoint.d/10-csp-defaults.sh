#!/bin/sh
set -eu

: "${CSP_ENV:=production}"
: "${CSP_CONNECT_SRC:=}"
: "${CSP_IMG_SRC:=}"

DOLLAR='$'
export DOLLAR
export RAKSHAKAI_CSP="$(node /docker-entrypoint.d/render-csp.cjs)"
