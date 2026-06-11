# RPi 코드 동기화 운영 가이드

## 문제 의식
로컬 `raspberry-pi/fallback-engine/` 의 변경이 git commit 되어도 **운영 중인 RPi 의 `/opt/smart-farm/fallback-engine/` 으로 자동 배포되지 않습니다.**
지금까지는 수동 rsync/scp 절차였고, 마지막 동기화 시점이 hk-house 의 fallback-engine 코드 마지막 수정일(`2026-05-21`)입니다.

## 권장 절차 (수동 동기화)

```bash
# 1) macOS → RPi /tmp 로 푸시
sshpass -e rsync -avz --exclude='node_modules' --exclude='package-lock.json' \
  -e "ssh -o StrictHostKeyChecking=no" \
  /Users/ohjeongseok/Projects/smart-farm-mqtt/raspberry-pi/fallback-engine/ \
  lgwadmin@<RPI_IP>:/tmp/fallback-engine-new/

# 2) RPi 측에서 sudo rsync + 재시작
sshpass -e ssh -tt -o StrictHostKeyChecking=no lgwadmin@<RPI_IP> \
  'echo "<PW>" | sudo -S bash -c "
cp -r /opt/smart-farm/fallback-engine /opt/smart-farm/fallback-engine.bak.$(date +%Y%m%d-%H%M%S)
rsync -a /tmp/fallback-engine-new/ /opt/smart-farm/fallback-engine/
chown -R root:root /opt/smart-farm/fallback-engine
systemctl restart fallback-engine
systemctl is-active fallback-engine
"'
```

## 향후 자동화 옵션 (TBD)
1. **MQTT 기반 코드 sync**: config-agent 처럼 코드 변경 알림 받고 자동 rsync. 복잡도 ↑
2. **systemd timer + git pull**: RPi 측에 `smart-farm-mqtt` git clone 해두고 timer 로 주기 pull
3. **Docker 컨테이너 배포**: container registry push → RPi 가 pull. 인프라 변경 大

## 동기화 체크리스트 (commit 이후)
- [ ] `raspberry-pi/` 하위 변경 commit
- [ ] 영향 받는 RPi 노드 목록 확정 (hk-house, lgw-dev 등)
- [ ] 각 노드에 rsync + 서비스 재시작
- [ ] 재시작 후 `systemctl is-active` 확인
- [ ] (선택) journal 확인 — 새 로그 적용 시 표식 검증

## 변경 이력
- 2026-06-08: 문서 신규 — hk-house 코드 5/21 였던 이슈 해결 시 작성 (`c405958` fan_trigger_type 동기화)
