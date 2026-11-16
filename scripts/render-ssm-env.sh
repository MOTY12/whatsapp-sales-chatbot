#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export AWS_PAGER=""

if [[ $# -ne 3 ]]; then
  printf 'Usage: %s /parameter/prefix variable-list output-file\n' "$0" >&2
  exit 2
fi
prefix=${1%/}
variables_file=$2
output_file=$3
if [[ ! -r "$variables_file" ]]; then
  printf 'Variable list is unreadable.\n' >&2
  exit 2
fi

mkdir -p "$(dirname "$output_file")"
temporary=$(mktemp "$(dirname "$output_file")/.kleva-env.XXXXXX")
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT

while IFS= read -r name || [[ -n "$name" ]]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  target=${name%%=*}
  source=${name#*=}
  if [[ "$source" == "$name" ]]; then source=$target; fi
  if [[ ! "$target" =~ ^[A-Z][A-Z0-9_]*$ || ! "$source" =~ ^[A-Z][A-Z0-9_]*(/[A-Z][A-Z0-9_]*)*$ ]]; then
    printf 'Invalid environment variable name in parameter list.\n' >&2
    exit 2
  fi
  value=$(aws ssm get-parameter \
    --name "$prefix/$source" --with-decryption \
    --query Parameter.Value --output text)
  encoded=$(printf '%s' "$value" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))')
  printf '%s=%s\n' "$target" "$encoded" >> "$temporary"
done < "$variables_file"

chmod 600 "$temporary"
mv -f "$temporary" "$output_file"
trap - EXIT
printf 'event=runtime_environment_updated target=%s\n' "$output_file"
