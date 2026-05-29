import { IsString, MaxLength, Matches } from 'class-validator';

export class UpdateGatewayIdDto {
  /** gateway-id (MQTT base_topic / DB FK에 사용 — 안전한 식별자만 허용) */
  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z0-9]([a-z0-9_-]{0,61}[a-z0-9])?$/, {
    message:
      'gateway-id는 소문자/숫자/하이픈/언더스코어로 구성하며 영숫자로 시작·종료해야 합니다 (1~63자)',
  })
  newGatewayId!: string;
}
