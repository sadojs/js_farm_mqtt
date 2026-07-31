import { Injectable, Logger } from '@nestjs/common';
import * as http2 from 'http2';
import * as jwt from 'jsonwebtoken';
import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface SendResult {
  token: string;
  platform: string;
  ok: boolean;
  invalid?: boolean; // true면 토큰이 무효(삭제 대상)
  error?: string;
}

/**
 * 네이티브 푸시 발송기 — iOS(APNs) / Android(FCM).
 *
 * ⚠️ 자격증명이 env 로 주입되지 않으면 완전히 비활성(no-op)이며, 프로덕션에서 아무 동작도
 *    하지 않는다(초기화·발송 모두 안전하게 skip). 자격증명 준비 후 아래 env 만 채우면 동작:
 *
 *  APNs (iOS):
 *    APNS_KEY_P8      - .p8 인증키 내용(개행은 \n 이스케이프 허용)
 *    APNS_KEY_ID      - 10자 Key ID
 *    APNS_TEAM_ID     - 10자 Team ID
 *    APNS_BUNDLE_ID   - (선택) 기본 com.jeongseokoh.smartfarm
 *    APNS_PRODUCTION  - 'true'면 운영 APNs, 아니면 sandbox
 *
 *  FCM (Android):
 *    FIREBASE_SERVICE_ACCOUNT - 서비스계정 JSON 문자열
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);

  private readonly apnsKey = process.env.APNS_KEY_P8?.replace(/\\n/g, '\n');
  private readonly apnsKeyId = process.env.APNS_KEY_ID;
  private readonly apnsTeamId = process.env.APNS_TEAM_ID;
  private readonly apnsBundleId = process.env.APNS_BUNDLE_ID || 'com.jeongseokoh.smartfarm';
  private readonly apnsHost =
    process.env.APNS_PRODUCTION === 'true'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com';
  private readonly apnsConfigured = !!(this.apnsKey && this.apnsKeyId && this.apnsTeamId);

  private fcmApp: App | null = null;
  private fcmConfigured = false;

  constructor() {
    this.initFcm();
    if (!this.apnsConfigured) {
      this.logger.warn('APNs 미설정 — iOS 푸시 비활성 (APNS_KEY_P8/APNS_KEY_ID/APNS_TEAM_ID 필요)');
    }
    if (!this.fcmConfigured) {
      this.logger.warn('FCM 미설정 — Android 푸시 비활성 (FIREBASE_SERVICE_ACCOUNT 필요)');
    }
  }

  private initFcm(): void {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return;
    try {
      const svc = JSON.parse(raw);
      this.fcmApp = getApps().length ? getApp() : initializeApp({ credential: cert(svc) });
      this.fcmConfigured = true;
    } catch (e) {
      this.logger.error('FCM 초기화 실패: ' + (e as Error).message);
    }
  }

  isConfigured(): boolean {
    return this.apnsConfigured || this.fcmConfigured;
  }

  async send(tokens: { token: string; platform: string }[], payload: PushPayload): Promise<SendResult[]> {
    const out: SendResult[] = [];
    for (const t of tokens) {
      if (t.platform === 'ios') {
        out.push(await this.sendApns(t.token, payload));
      } else if (t.platform === 'android') {
        out.push(await this.sendFcm(t.token, payload));
      } else {
        out.push({ token: t.token, platform: t.platform, ok: false, error: 'unknown-platform' });
      }
    }
    return out;
  }

  private sendApns(token: string, payload: PushPayload): Promise<SendResult> {
    return new Promise((resolve) => {
      if (!this.apnsConfigured) {
        resolve({ token, platform: 'ios', ok: false, error: 'apns-not-configured' });
        return;
      }
      let bearer: string;
      try {
        bearer = jwt.sign({ iss: this.apnsTeamId, iat: Math.floor(Date.now() / 1000) }, this.apnsKey as string, {
          algorithm: 'ES256',
          keyid: this.apnsKeyId,
        });
      } catch (e) {
        resolve({ token, platform: 'ios', ok: false, error: 'jwt:' + (e as Error).message });
        return;
      }

      const body = JSON.stringify({
        aps: { alert: { title: payload.title, body: payload.body }, sound: 'default' },
        ...(payload.data || {}),
      });

      const client = http2.connect(this.apnsHost);
      let settled = false;
      const done = (r: SendResult) => {
        if (settled) return;
        settled = true;
        try { client.close(); } catch { /* noop */ }
        resolve(r);
      };
      client.on('error', (e) => done({ token, platform: 'ios', ok: false, error: e.message }));

      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${bearer}`,
        'apns-topic': this.apnsBundleId,
        'apns-push-type': 'alert',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });

      let status = 0;
      let data = '';
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        if (status === 200) {
          done({ token, platform: 'ios', ok: true });
        } else {
          const invalid = status === 410 || /BadDeviceToken|Unregistered/.test(data);
          done({ token, platform: 'ios', ok: false, invalid, error: `apns ${status} ${data}`.trim() });
        }
      });
      req.on('error', (e) => done({ token, platform: 'ios', ok: false, error: e.message }));
      req.end(body);
    });
  }

  private async sendFcm(token: string, payload: PushPayload): Promise<SendResult> {
    if (!this.fcmConfigured || !this.fcmApp) {
      return { token, platform: 'android', ok: false, error: 'fcm-not-configured' };
    }
    try {
      await getMessaging(this.fcmApp).send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      });
      return { token, platform: 'android', ok: true };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const invalid =
        code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument';
      return { token, platform: 'android', ok: false, invalid, error: (e as Error).message };
    }
  }
}
