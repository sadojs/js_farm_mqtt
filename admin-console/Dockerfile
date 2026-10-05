# 플랫폼 관리자 콘솔 — 운영 이미지 (node 빌드 → nginx)
#
# 빌드 컨텍스트는 저장소 루트: 콘솔이 기존 화면(frontend/src)을 그대로 import 하기 때문.
# 컨텍스트에 들어가는 파일은 같은 폴더의 Dockerfile.dockerignore(BuildKit) 로 제한한다.
#   docker compose -f admin-console/docker-compose.console.yml build
#
# frontend/ 는 읽기만 한다(복사 후 빌드). 기존 frontend 이미지·컨테이너와 무관.

# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY admin-console/package.json admin-console/package-lock.json ./admin-console/
RUN cd admin-console && npm ci --no-audit --no-fund

COPY admin-console/ ./admin-console/
COPY frontend/src/ ./frontend/src/
COPY frontend/public/ ./frontend/public/
# frontend/src 안의 import 도 콘솔 node_modules 를 찾도록 연결 (기존 frontend 의존성은 설치하지 않음)
RUN ln -s /app/admin-console/node_modules /app/frontend/node_modules

# 게이트웨이 Pi 설치 명령에 들어가는 서버 주소/계정 — 기존 frontend/Dockerfile 과 같은 운영 기본값
ARG VITE_SERVER_HOST=urifarm.com
ARG VITE_SERVER_USER=jeongseok
ENV VITE_SERVER_HOST=$VITE_SERVER_HOST
ENV VITE_SERVER_USER=$VITE_SERVER_USER
RUN cd admin-console && npm run build

# ---- Production Stage ----
FROM nginx:alpine AS production

COPY --from=builder /app/admin-console/dist /usr/share/nginx/html
# nginx 공식 이미지는 /etc/nginx/templates/*.template 을 envsubst 해서 conf.d 에 둔다 (BACKEND_UPSTREAM)
COPY admin-console/nginx.conf /etc/nginx/templates/default.conf.template
ENV BACKEND_UPSTREAM=sfm-backend:3100

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
