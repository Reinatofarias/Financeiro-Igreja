#!/usr/bin/env bash
# Junta as migrações num arquivo único para colar no SQL Editor do Supabase.
set -euo pipefail
cd "$(dirname "$0")"
out=instalar.sql
{
  echo "-- Financeiro da Igreja: instalação completa do banco."
  echo "-- Gerado por supabase/gerar-instalar.sh a partir de supabase/migrations/. Não edite à mão."
  echo "-- Supabase > SQL Editor > colar tudo > Run. Rode uma única vez, num projeto novo."
  echo
  echo "begin;"
  for f in migrations/*.sql; do
    echo
    echo "-- ===================================================================="
    echo "-- $f"
    echo "-- ===================================================================="
    cat "$f"
  done
  echo
  echo "commit;"
} > "$out"
echo "gerado: supabase/$out ($(wc -l < "$out") linhas)"
