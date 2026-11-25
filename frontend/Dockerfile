# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# 게이트웨이 셋업 커맨드용 서버 주소/계정 — docker 빌드는 프로덕션 배포이므로 프로덕션 기본값을 baked.
#   (소스 폴백은 dev값: 172.30.1.42 / ohjeongseok. dev 는 npm run dev 로 docker 미경유 → 영향 없음)
#   필요 시: docker compose build --build-arg VITE_SERVER_USER=... --build-arg VITE_SERVER_HOST=...
ARG VITE_SERVER_HOST=urifarm.com
ARG VITE_SERVER_USER=jeongseok
ENV VITE_SERVER_HOST=$VITE_SERVER_HOST
ENV VITE_SERVER_USER=$VITE_SERVER_USER
RUN npm run build

# ---- Production Stage ----
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# 80 은 https://$host:8443 으로 301 리다이렉트만 하므로(컨테이너 안엔 8443 없음) 443 을 직접 확인한다
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider --no-check-certificate https://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
