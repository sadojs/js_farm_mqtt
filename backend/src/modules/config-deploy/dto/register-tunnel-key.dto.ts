import { IsString, MaxLength, Matches, IsOptional } from 'class-validator';

export class RegisterTunnelKeyDto {
  /** 골든 이미지 동봉 hostname (보통 'lgw-default') */
  @IsString()
  @MaxLength(63)
  gatewayId!: string;

  /** OpenSSH ed25519/rsa 공개키 한 줄 */
  @IsString()
  @MaxLength(4096)
  @Matches(/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+\S+(\s+.*)?$/, {
    message: '공개키는 OpenSSH authorized_keys 형식이어야 합니다',
  })
  publicKey!: string;

  /** /etc/machine-id (Pi당 unique) */
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-f0-9]{8,64}$/, { message: 'machineId는 16진수 문자열이어야 합니다' })
  machineId!: string;

  /** Pi에서 보고하는 자체 IP (선택, 진단용) */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  rpiIp?: string;
}
