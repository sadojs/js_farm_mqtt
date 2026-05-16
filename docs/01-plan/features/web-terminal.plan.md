# Plan: web-terminal

## Feature Summary
NAT 뒤의 라즈베리파이에 브라우저에서 직접 SSH 터미널로 접속할 수 있는 웹 콘솔 기능.
기존 autossh 리버스 터널 인프라를 활용해 별도 VPN 없이 어디서나 접속 가능.

## Problem Statement
- 라즈베리파이는 NAT 뒤에 있어 외부에서 직접 SSH 접속 불가
- 현재는 프로덕션 서버에서 로컬 터미널로만 접속 가능
- 웹 브라우저에서 언제 어디서나 Pi 쉘에 접근할 수 있어야 함

## Goals
1. 브라우저에서 라즈베리파이 SSH 터미널 접속
2. 기존 JWT 인증으로 접근 제어 (admin/farm_admin만 가능)
3. config-deploy를 MQTT 대신 SSH 직접 실행으로 단순화

## Architecture
- Frontend (xterm.js) → WebSocket(/ssh namespace) → NestJS(ssh2) → SSH tunnel(127.0.0.1:{tunnelPort}) → Pi
- config-deploy: MQTT round-trip 제거, SSH exec + SFTP로 직접 배포

## Scope
- Backend: ssh-proxy 모듈 (SshProxyService + SshProxyGateway)
- Frontend: WebTerminal.vue 컴포넌트, GatewayManagement 통합
- config-deploy 리팩토링 (MQTT → SSH)

## Out of Scope
- 녹화/재생 기능
- 다중 탭 터미널
- 파일 브라우저
