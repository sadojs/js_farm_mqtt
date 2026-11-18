#!/bin/zsh
# Smart Farm — 매일 DB 백업 (운영 서버에서 cron 으로 실행)
#
#   - docker exec sfm-db pg_dump -Fc → 임시 파일 → 검증(pg_restore --list) → 날짜 파일로 확정
#   - 보관: 일별 14개 + 매주 일요일분 8개 (그 밖은 삭제)
#   - 선택: BACKUP_REMOTE(rsync 대상, 예: user@nas:/backups/smartfarm/) 가 있으면 사본을 다른 곳으로 복사
#   - 어떤 단계도 멈추지 않도록 timeout(perl alarm). 실패하면 backups/backup.fail 을 남긴다(healthcheck 가 볼 수 있음).
#
# 설정(.env 와 같은 폴더에서 읽음): POSTGRES_USER, POSTGRES_DB, (선택) BACKUP_REMOTE, BACKUP_DIR
# 복원: docker exec -i sfm-db pg_restore -U <user> -d <db> --clean --if-exists < smartfarm-YYYYMMDD-HHMM.dump
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

ROOT="${SFM_ROOT:-$HOME/Projects/js_farm_mqtt}"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
DIR="${BACKUP_DIR:-$HOME/smartfarm-backups}"
CONTAINER="${DB_CONTAINER:-sfm-db}"
LOG="$DIR/backup.log"
mkdir -p "$DIR"; chmod 700 "$DIR"

log() { print -r -- "$(date '+%F %T') $*" >> "$LOG"; }
fail() { log "FAIL: $*"; print -r -- "$(date '+%F %T') $*" > "$DIR/backup.fail"; exit 1; }
# run_to <초> 명령… — 제한 시간 넘으면 종료
run_to() { local t=$1; shift; perl -e 'alarm shift; exec @ARGV' "$t" "$@"; }

[ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_DB:-}" ] || fail "POSTGRES_USER/POSTGRES_DB 없음 ($ROOT/.env)"

STAMP="$(date +%Y%m%d-%H%M)"
TMP="$DIR/.tmp-$STAMP.dump"
OUT="$DIR/smartfarm-$STAMP.dump"

run_to 900 docker exec "$CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$TMP" 2>>"$LOG" \
  || { rm -f "$TMP"; fail "pg_dump 실패/시간초과"; }

SIZE=$(stat -f%z "$TMP" 2>/dev/null || echo 0)
[ "$SIZE" -gt 10240 ] || { rm -f "$TMP"; fail "덤프가 너무 작음(${SIZE}B)"; }

# 덤프 목차를 읽을 수 있는지(깨지지 않았는지) 확인
run_to 120 docker exec -i "$CONTAINER" pg_restore --list < "$TMP" > /dev/null 2>>"$LOG" \
  || { rm -f "$TMP"; fail "덤프 검증(pg_restore --list) 실패"; }

mv "$TMP" "$OUT" && chmod 600 "$OUT"
rm -f "$DIR/backup.fail"
log "OK $OUT ($(( SIZE / 1024 / 1024 ))MB)"

# 보관 정책: 최근 14개 + 일요일분 8개
typeset -a files; files=("${(@f)$(ls -1t "$DIR"/smartfarm-*.dump 2>/dev/null)}")
keep_daily=14; keep_weekly=8; weekly=0; i=0
for f in $files; do
  i=$((i+1))
  [ $i -le $keep_daily ] && continue
  d="${f:t}"; d="${d#smartfarm-}"; d="${d%%-*}"
  if [ "$(date -j -f %Y%m%d "$d" +%u 2>/dev/null)" = "7" ] && [ $weekly -lt $keep_weekly ]; then
    weekly=$((weekly+1)); continue
  fi
  rm -f "$f" && log "삭제(보관기간 지남) ${f:t}"
done

# 다른 곳으로 복사(선택)
if [ -n "${BACKUP_REMOTE:-}" ]; then
  run_to 1200 rsync -a --delete-after -e "ssh -o BatchMode=yes -o ConnectTimeout=20" \
    --include='smartfarm-*.dump' --exclude='*' "$DIR/" "$BACKUP_REMOTE" >>"$LOG" 2>&1 \
    && log "원격 복사 OK → $BACKUP_REMOTE" || fail "원격 복사 실패 → $BACKUP_REMOTE"
else
  log "원격 복사 없음(BACKUP_REMOTE 미설정)"
fi
