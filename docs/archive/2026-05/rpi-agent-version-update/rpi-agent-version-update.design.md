# Design: rpi-agent-version-update

**Feature ID**: `rpi-agent-version-update`
**작성일**: 2026-05-25
**기반 문서**: [01-plan/features/rpi-agent-version-update.plan.md](../../01-plan/features/rpi-agent-version-update.plan.md)
**상태**: Design (Phase 1 only)

---

## 1. 사전 분석 결과 + 아키텍처 재설계

### Plan 가정 정정
Plan에서는 PI agent가 git clone 형태로 설치되어 있어 `git pull`로 update 가능하다고 가정. **그러나 실제 setup.sh는 `cp -r` 파일 복사 방식**(setup.sh:289, 335, 385) — `.git` 디렉토리 없음. git pull 불가.

### 재설계 옵션

| 옵션 | 설명 | 장점 | 단점 |
|---|---|---|---|
| **A. HTTP archive 다운로드 (선택)** | Backend가 raspberry-pi/{agent}/ 폴더를 tar.gz로 stream. PI가 curl 받아 extract | SSH 인증 불필요, backend가 source of truth, atomic | tar/curl 의존, 큰 archive 시 메모리 |
| B. rsync over reverse SSH tunnel | Mac에서 PI에 rsync push | 가장 빠른 sync (delta only) | server → PI SSH 키 필요, tunnel 의존 |
| C. setup.sh를 git clone 패턴으로 전환 | 모든 PI 재셋업 필요 | 표준 패턴 | 골든 이미지 재빌드 + 운영 PI 전환 비용 |
| D. MQTT 메시지로 코드 전송 | 메시지 크기 제한 | 단순 | 메시지 크기 제한, retain 부담 |

### 결정: **옵션 A (HTTP archive)** + Phase 1만

근거:
- PI는 backend에 reverse tunnel로 도달 가능 (192.168.0.100:3100 fallback도 OK)
- backend가 자기 raspberry-pi/ 폴더의 단일 source of truth (운영 시 `git pull` + restart로 update)
- tar/curl은 PI에 기본 설치
- atomic: tar archive 전체 받은 후 적용

---

## 2. 시퀀스

```
운영자 ──POST──> backend ──MQTT publish──> PI config-agent
                  /api/.../agent-update
                  body: {agent: "config-agent"}
                                              │
                                              ▼
                                       apply-agent-update.sh config-agent
                                              │
                                              │  GET /api/config-deploy/agent-archive/config-agent
                                              ▼
                                       backend ──tar.gz stream──> PI
                                              │
                                              ▼
                                       /tmp에 extract
                                       /opt/smart-farm/config-agent.bak 백업
                                       /opt/smart-farm/config-agent 교체
                                       npm install --omit=dev
                                       systemctl restart config-agent
                                       30s status check
                                              │
                              ┌───────────────┴─────────────┐
                              ▼                             ▼
                       성공: .bak 삭제, JSON 응답         실패: .bak 복원 + restart + 실패 보고
```

---

## 3. 구현 항목

### 3.1 Backend
- **새 endpoint** `GET /api/config-deploy/agent-archive/:agent` (admin only, public X)
  - `:agent ∈ {config-agent, gpio-agent, fallback-engine}`
  - `raspberry-pi/{agent}/` 폴더를 tar.gz로 stream
  - `node-tar` 사용 또는 `child_process.spawn('tar', ['czf', '-', '...'])`
  - 응답 헤더: `Content-Type: application/gzip`, `Content-Disposition: attachment; filename=config-agent.tar.gz`
- **새 endpoint** `POST /api/config-deploy/:gatewayId/agent-update` (admin only)
  - body: `{agent: 'config-agent'|'gpio-agent'|'fallback-engine'}`
  - MQTT publish `agent_update` action with `agent` field
  - 응답 추적 (기존 publishAndTrack 패턴)
- DTO: `UpdateAgentDto { agent: 'config-agent'|'gpio-agent'|'fallback-engine' }`
- ConfigAction에 `agent_update` 추가
- TIMEOUTS_MS에 `agent_update: 120_000` (2분 — npm install 고려)

### 3.2 PI 측
- **신규 스크립트** `raspberry-pi/scripts/apply-agent-update.sh`:
  ```bash
  AGENT="$1"  # config-agent / gpio-agent / fallback-engine
  SERVER_IP="$(cat /etc/smartfarm/server-ip)"
  TOKEN="$(cat /etc/smartfarm/bootstrap.token)"
  DIR="/opt/smart-farm/${AGENT}"
  TMP=$(mktemp -d)
  
  # 1. archive 다운로드
  curl -fsSL -H "X-Smartfarm-Bootstrap-Token: ${TOKEN}" \
    "http://${SERVER_IP}:3100/api/config-deploy/agent-archive/${AGENT}" \
    -o "${TMP}/agent.tar.gz" || { emit_fail "다운로드 실패"; exit 1; }
  
  # 2. 검증 (tar 무결성)
  tar -tzf "${TMP}/agent.tar.gz" >/dev/null || { emit_fail "tar 손상"; exit 1; }
  
  # 3. 백업
  rm -rf "${DIR}.bak"
  cp -r "${DIR}" "${DIR}.bak"
  
  # 4. 교체 + npm install
  tar -xzf "${TMP}/agent.tar.gz" -C "${TMP}/extract"
  rsync -a --delete "${TMP}/extract/" "${DIR}/"
  (cd "${DIR}" && npm install --omit=dev) || { rollback; exit 1; }
  
  # 5. 재시작 + 검증
  systemctl restart "${AGENT}"
  sleep 5
  STATE=$(systemctl is-active "${AGENT}")
  if [ "$STATE" != "active" ]; then
    rollback
    emit_fail "service 시작 실패"
    exit 1
  fi
  
  # 6. 정리
  rm -rf "${DIR}.bak" "${TMP}"
  emit_success
  ```
- **config-agent handler** `raspberry-pi/config-agent/handlers/agent-update.js`:
  ```javascript
  module.exports.handleAgentUpdate = async (request) => {
    const { agent } = request;
    if (!['config-agent', 'gpio-agent', 'fallback-engine'].includes(agent)) {
      return { ok: false, status: 'failed', detail: 'invalid agent name' };
    }
    return runScript('apply-agent-update.sh', [agent], 180_000);
  };
  ```
- **config-agent index.js dispatcher**:
  ```javascript
  case 'agent_update':
    await runRemoteAction(requestId, action, () => handleAgentUpdate(request));
    break;
  ```

### 3.3 Frontend (Phase 1: 단일 게이트웨이만)
- 본 사이클 Phase 1은 backend + PI 측만. Frontend N대 UI는 Phase 2 (별도 사이클).

---

## 4. 검증 (Phase 1, AT 4건)

### AT-01: archive endpoint 동작
```bash
TOKEN=$(cat /tmp/.sf-token)
curl -H "Authorization: Bearer $TOKEN" -o /tmp/cfg.tgz \
  "http://localhost:3100/api/config-deploy/agent-archive/config-agent"
tar -tzf /tmp/cfg.tgz | head -5
# Expected: handlers/, index.js, package.json 등
```

### AT-02: lgw-pilot01에 config-agent update 1회 (자기 자신 update — 위험 시나리오)
- config-agent가 자기 자신을 update → systemctl restart → 진행 중 끊김 → 마지막 status는?
- → 위험 회피: handler가 `exec script + exit`로 진행하면 systemctl restart로 자신 종료. 응답 전송 못함.
- 대안: handler가 immediate 응답 후 background로 script 실행. 또는 fallback-engine부터 검증 (config-agent와 무관).

### AT-03: lgw-pilot01에 fallback-engine update (안전)
- fallback-engine은 config-agent와 별개 service. config-agent가 살아 있고 fallback-engine만 update.
- 응답: success + 새 commit hash (또는 package.json version)

### AT-04: 실패 시 rollback
- 잘못된 코드 (예: syntax error)를 backend에 잠시 commit → archive 받음 → systemctl 시작 실패 → rollback → .bak 복원 → service 재시작 정상

---

## 5. 위험 + 완화

| Risk | Mitigation |
|---|---|
| config-agent 자기 자신 update → 응답 전송 중 끊김 | Phase 1은 fallback-engine만 검증. config-agent self-update는 Phase 2에 systemd Type=forking 또는 별도 launcher 도입 |
| 네트워크 단절로 archive 다운로드 실패 | curl 5회 retry + .bak 보존 |
| npm install 실패 (Pi 3B 메모리) | --omit=dev + npm cache. 실패 시 rollback |
| backend 측 raspberry-pi/ 폴더가 git pull 안 됨 | 운영 절차로 backend 측 git pull + restart 명시 |
| archive 인증 (Bootstrap-Token만으로 충분?) | Phase 1: Bootstrap-Token 사용. Phase 2: JWT + per-gateway scope |

---

## 6. Phase 1 단계 (Do)

1. **DTO + ConfigAction + TIMEOUTS_MS**
2. **GET /agent-archive/:agent endpoint** (Backend)
3. **POST /:gw/agent-update endpoint** (Backend)
4. **apply-agent-update.sh** (PI script)
5. **config-agent handlers/agent-update.js + index.js dispatcher**
6. **PI 배포 + AT-03 fallback-engine update 검증**
7. **AT-04 rollback 검증** (의도적 실패 케이스)

### Phase 2 (별도 사이클 — 본 사이클 out of scope)
- Frontend N대 일괄 UI
- config-agent self-update 안전 패턴 (launcher / systemd Type=forking)
- dry-run 모드
- canary 배포

---

## 7. 회귀 영향

- lgw-dev: 영향 0 (명시적 호출 안 함)
- backend raspberry-pi/ 폴더 git 상태가 source of truth (운영자 책임)
- PI 측 agent들이 backend로부터 코드를 능동적으로 받게 됨 (배포 모델 변화)
