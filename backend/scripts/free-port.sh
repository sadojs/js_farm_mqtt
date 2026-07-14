#!/usr/bin/env bash
# free-port.sh — start:dev 직전 대상 포트 점유 프로세스 정리.
#
# 배경: `nest start --watch` 가 코드 변경 시 자식 프로세스(node dist/main)를 재시작하는데,
#        드물게 그 자식이 프로세스 그룹 밖에 남아(orphan) 포트를 계속 물고 있다.
#        그러면 다음 재시작(launchctl kickstart) 때 새 인스턴스가 포트 바인딩에 실패하고,
#        낡은 orphan 이 계속 낡은 코드를 서빙한다(pull/빌드 후에도 반영 안 됨).
#
# 대응: prestart:dev 로 이 스크립트를 실행해, start 직전에 대상 포트를 점유한 PID 를 정리.
# 안전: PORT(기본 3100)만 대상 → 다른 프로젝트/서비스(다른 포트)에는 영향 없음.
set -u
PORT="${PORT:-3100}"

# launchd 의 최소 PATH 에는 /usr/sbin(macOS lsof), /sbin 이 없어 lsof 를 못 찾는다.
# 시스템 경로를 보정해 lsof 를 항상 찾도록 한다. (macOS: /usr/sbin/lsof, Linux: /usr/bin/lsof)
export PATH="/usr/sbin:/sbin:/usr/bin:/bin:${PATH:-}"

pids="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
if [ -n "$pids" ]; then
  echo "[free-port] TCP ${PORT} 점유 프로세스 정리: ${pids}"
  # shellcheck disable=SC2086
  kill -9 ${pids} 2>/dev/null || true
  sleep 0.3
fi
exit 0
