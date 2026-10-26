#!/usr/bin/env bash
# Aplica as migrações num Postgres descartável e roda os testes SQL.
# Uso: DATABASE_URL=postgres://... supabase/tests/run.sh   (o banco precisa estar vazio)
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?defina DATABASE_URL apontando para um banco vazio}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  echo "migração: $f"
  "${PSQL[@]}" -f "$f"
done
for f in supabase/tests/[0-9][0-9]_*.sql; do
  [[ "$f" == *00_supabase_stub.sql ]] && continue
  echo "teste: $f"
  "${PSQL[@]}" -f "$f"
done
echo "OK: todos os testes SQL passaram"
