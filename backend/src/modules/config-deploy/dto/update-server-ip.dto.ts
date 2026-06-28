import { IsString, MaxLength, Matches, IsOptional } from 'class-validator';

export class UpdateServerIpDto {
  /**
   * MQTT/Tunnel 서버 주소 — IPv4 또는 FQDN.
   * 포트/스킴 없이 호스트 부분만 (예: "172.30.1.42", "farm.example.com").
   */
  @IsString()
  @MaxLength(255)
  @Matches(
    /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/,
    { message: 'newServerIp는 IPv4 또는 FQDN 형식이어야 합니다 (스킴·포트 제외)' },
  )
  newServerIp!: string;

  /**
   * 선택: 새 서버의 BOOTSTRAP_TOKEN.
   * 다른 서버(예: 개발→프로덕션)로 전환 시 Pi가 새 서버에 재등록하려면 그 서버의 토큰이 필요하다.
   * (비우면 기존 토큰 유지 — 같은 서버 IP만 바뀐 경우)
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  bootstrapToken?: string;

  /** 선택: 새 망 WiFi SSID (HQ/개발망 → 농장/프로덕션망 전환 시 함께 변경) */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ssid?: string;

  /** 선택: 새 망 WiFi 비밀번호 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  psk?: string;
}
