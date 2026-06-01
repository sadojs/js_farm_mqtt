import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';

/**
 * device-replacement — POST /api/devices/:id/replace
 *
 * devices.id를 유지한 채 zigbee_ieee/friendly_name만 swap.
 * controller(parent)인 경우 children도 동일 IEEE로 일괄 swap.
 */
export class ReplaceDeviceDto {
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'newIeee는 0x로 시작하는 hex 문자열' })
  newIeee!: string;

  @IsString()
  newFriendlyName!: string;

  @IsOptional()
  @IsString()
  newZigbeeModel?: string;

  /** 새 device가 갖는 채널 수 (1/8/12) — 채널 증설 케이스 허용 검증용 */
  @IsOptional()
  @IsInt()
  @IsIn([1, 8, 12])
  newChannelCount?: 1 | 8 | 12;

  /** 페어 개폐기일 때 필수 — 페어 동시 교체 강제 (FR-06 호환) */
  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]+$/, { message: 'pairedNewIeee는 0x로 시작하는 hex 문자열' })
  pairedNewIeee?: string;

  @IsOptional()
  @IsString()
  pairedNewFriendlyName?: string;

  /** FR-09 — true면 진행 중 관수 timeline 강제 중단 후 교체, false면 409 차단 */
  @IsOptional()
  @IsBoolean()
  forceStopRunningTimeline?: boolean;
}
