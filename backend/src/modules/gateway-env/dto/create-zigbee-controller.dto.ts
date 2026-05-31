import { IsIn, IsInt, IsString, Matches } from 'class-validator';

/**
 * Zigbee 8/12채널 컨트롤러 등록 DTO.
 * mode='irrigation' — 기존 zigbee 관수 device 1개
 * mode='fan'        — N개 유동팬 child
 * mode='opener'     — N/2 페어 개폐기 child
 */
export class CreateZigbeeControllerDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'ieee는 0x로 시작하는 hex 문자열' })
  ieee!: string;

  @IsString()
  friendlyName!: string;

  @IsString()
  zigbeeModel!: string;

  @IsInt()
  @IsIn([8, 12], { message: 'channelCount는 8 또는 12' })
  channelCount!: 8 | 12;

  @IsIn(['irrigation', 'fan', 'opener'])
  mode!: 'irrigation' | 'fan' | 'opener';
}
