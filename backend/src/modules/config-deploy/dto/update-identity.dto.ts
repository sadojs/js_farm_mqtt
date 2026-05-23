import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

/**
 * hostname + gateway-id 통합 변경 DTO (rpi-hostname-gateway-id-unify).
 *
 * 두 값이 항상 같다는 invariant 전제 — 양산 시나리오에서 분리 배포로 인한
 * 불일치/실수 방지. RFC 1123 hostname 정규식이 gateway-id 정규식보다
 * 좁으므로 통합 시 더 좁은 hostname 기준 적용.
 */
export class UpdateIdentityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(63)
  @Matches(/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/, {
    message:
      'name은 소문자/숫자/하이픈으로 구성하며 소문자로 시작하고 영숫자로 끝나야 합니다 (RFC 1123, 1~63자)',
  })
  name!: string;
}
