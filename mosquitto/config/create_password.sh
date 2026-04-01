#!/bin/bash
# Mosquitto MQTT 비밀번호 파일 생성 스크립트
# 사용법: docker exec mosquitto sh -c "mosquitto_passwd -c /mosquitto/config/password_file smartfarm"
# 또는 이 스크립트를 실행하여 초기 설정

MQTT_USER=${1:-smartfarm}
MQTT_PASS=${2:-$(openssl rand -base64 24)}

echo "MQTT User: $MQTT_USER"
echo "MQTT Password: $MQTT_PASS"
echo ""
echo "아래 명령어로 Mosquitto 컨테이너에서 비밀번호를 생성하세요:"
echo "  docker exec mosquitto mosquitto_passwd -c /mosquitto/config/password_file $MQTT_USER"
echo ""
echo ".env 파일에 아래 값을 설정하세요:"
echo "  MQTT_USERNAME=$MQTT_USER"
echo "  MQTT_PASSWORD=$MQTT_PASS"
