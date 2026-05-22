import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class UpdateWifiDto {
  /** Wi-Fi SSID (1~32바이트, 모든 인쇄 가능 문자) */
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  ssid!: string;

  /** WPA2/WPA3 비밀번호 — 8~63자 ASCII passphrase 또는 64자 hex PMK */
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password!: string;
}
