import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';

interface TuyaTokenResponse {
  result: {
    access_token: string;
    expire_time: number;
    refresh_token: string;
    uid: string;
  };
  success: boolean;
  t: number;
  msg?: string;
}

interface TuyaCredentials {
  accessId: string;
  accessSecret: string;
  endpoint: string;
}

@Injectable()
export class TuyaService {
  private readonly logger = new Logger(TuyaService.name);
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  /**
   * Tuya OpenAPI 토큰 발급
   */
  async getToken(credentials: TuyaCredentials): Promise<string> {
    const cacheKey = `${credentials.accessId}@${credentials.endpoint}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const timestamp = Date.now().toString();
    const nonce = crypto.randomUUID();
    const method = 'GET';
    const path = '/v1.0/token?grant_type=1';
    const contentHash = crypto.createHash('sha256').update('').digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr = credentials.accessId + timestamp + nonce + stringToSign;
    const sign = crypto
      .createHmac('sha256', credentials.accessSecret)
      .update(signStr)
      .digest('hex')
      .toUpperCase();

    const { data } = await axios.get<TuyaTokenResponse>(
      `${credentials.endpoint}${path}`,
      {
        headers: {
          client_id: credentials.accessId,
          sign,
          t: timestamp,
          sign_method: 'HMAC-SHA256',
          nonce,
        },
      },
    );

    if (!data.success) {
      throw new Error(`Tuya token 발급 실패: ${data.msg}`);
    }

    this.tokenCache.set(cacheKey, {
      token: data.result.access_token,
      expiresAt: Date.now() + (data.result.expire_time - 60) * 1000,
    });

    return data.result.access_token;
  }

  /**
   * Tuya OpenAPI 요청 서명 생성 (토큰 포함)
   */
  private signRequest(
    credentials: TuyaCredentials,
    token: string,
    method: string,
    path: string,
    body: string = '',
  ) {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomUUID();
    const contentHash = crypto.createHash('sha256').update(body).digest('hex');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const signStr =
      credentials.accessId + token + timestamp + nonce + stringToSign;
    const sign = crypto
      .createHmac('sha256', credentials.accessSecret)
      .update(signStr)
      .digest('hex')
      .toUpperCase();

    return {
      headers: {
        client_id: credentials.accessId,
        access_token: token,
        sign,
        t: timestamp,
        sign_method: 'HMAC-SHA256',
        nonce,
      },
    };
  }

  /**
   * Tuya API GET 요청
   */
  async apiGet(credentials: TuyaCredentials, path: string): Promise<any> {
    const token = await this.getToken(credentials);
    const { headers } = this.signRequest(
      credentials,
      token,
      'GET',
      path,
    );

    const { data } = await axios.get(`${credentials.endpoint}${path}`, {
      headers,
    });

    return data;
  }

  /**
   * Tuya API POST 요청
   */
  async apiPost(
    credentials: TuyaCredentials,
    path: string,
    body: any = {},
  ): Promise<any> {
    const token = await this.getToken(credentials);
    const bodyStr = JSON.stringify(body);
    const { headers } = this.signRequest(
      credentials,
      token,
      'POST',
      path,
      bodyStr,
    );

    const { data } = await axios.post(
      `${credentials.endpoint}${path}`,
      body,
      {
        headers: { ...headers, 'Content-Type': 'application/json' },
      },
    );

    return data;
  }

  /**
   * 연결 테스트: 토큰 발급 + 디바이스 목록 조회
   */
  async testConnection(credentials: TuyaCredentials): Promise<{
    success: boolean;
    tokenOk: boolean;
    deviceCount: number;
    message: string;
    devices?: any[];
  }> {
    // 1단계: 토큰 발급 테스트
    let token: string;
    try {
      token = await this.getToken(credentials);
      this.logger.log(`Tuya 토큰 발급 성공: ${token.substring(0, 8)}...`);
    } catch (err: any) {
      this.logger.error('Tuya 토큰 발급 실패:', err.message);
      return {
        success: false,
        tokenOk: false,
        deviceCount: 0,
        message: `Tuya 인증 실패: Access ID 또는 Access Secret이 올바르지 않습니다. (${err.response?.data?.msg || err.message})`,
      };
    }

    // 2단계: 디바이스 목록 조회
    try {
      const devicesResult = await this.apiGet(
        credentials,
        '/v1.0/iot-01/associated-users/devices?last_row_key=&size=20',
      );

      if (!devicesResult.success) {
        return {
          success: true,
          tokenOk: true,
          deviceCount: 0,
          message: `Tuya Cloud 인증 성공! 디바이스 조회 권한 없음: ${devicesResult.msg || '데이터 센터 활성화 필요'}`,
        };
      }

      const devices = devicesResult.result?.devices || [];
      return {
        success: true,
        tokenOk: true,
        deviceCount: devices.length,
        message: `Tuya Cloud 연결 성공! ${devices.length}개 디바이스 발견`,
        devices: devices.map((d: any) => ({
          id: d.id,
          name: d.name,
          category: d.category,
          online: d.online,
          product_name: d.product_name,
        })),
      };
    } catch (err: any) {
      return {
        success: true,
        tokenOk: true,
        deviceCount: 0,
        message: `Tuya Cloud 인증 성공! 디바이스 API 호출 실패: ${err.response?.data?.msg || err.message}`,
      };
    }
  }

  /**
   * 특정 디바이스 상태 조회
   */
  async getDeviceStatus(
    credentials: TuyaCredentials,
    deviceId: string,
  ): Promise<any> {
    return this.apiGet(credentials, `/v1.0/devices/${deviceId}/status`);
  }

  /**
   * 디바이스 명령 전송
   */
  async sendDeviceCommand(
    credentials: TuyaCredentials,
    deviceId: string,
    commands: { code: string; value: any }[],
  ): Promise<any> {
    return this.apiPost(credentials, `/v1.0/devices/${deviceId}/commands`, {
      commands,
    });
  }
}
