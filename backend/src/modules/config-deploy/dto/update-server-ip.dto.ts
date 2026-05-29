import { IsString, MaxLength, Matches } from 'class-validator';

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
}
