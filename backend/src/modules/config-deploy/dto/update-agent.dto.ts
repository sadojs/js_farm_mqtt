import { IsIn, IsString } from 'class-validator';

/**
 * rpi-agent-version-update
 * Pi agent 코드 업데이트 DTO.
 *
 * 자체 update 위험성으로 Phase 1은 fallback-engine만 검증 권장.
 * config-agent / gpio-agent self-update는 Phase 2에서 안전 패턴(launcher) 도입.
 */
export class UpdateAgentDto {
  @IsString()
  @IsIn(['config-agent', 'gpio-agent', 'fallback-engine'])
  agent!: 'config-agent' | 'gpio-agent' | 'fallback-engine';
}
