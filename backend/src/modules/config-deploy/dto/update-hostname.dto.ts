import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdateHostnameDto {
  /** RFC 1123 hostname (a-z 시작, 끝은 a-z0-9, 중간은 a-z0-9-, 1~63자) */
  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/, {
    message:
      'hostname은 소문자/숫자/하이픈으로 구성하며 소문자로 시작하고 영숫자로 끝나야 합니다 (RFC 1123, 1~63자)',
  })
  hostname!: string;
}
