import { Controller, Post, Get, Body, UseGuards, Res, Req } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const REFRESH_COOKIE = 'rft';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
  path: '/',
};
// 쿠키 삭제는 '설정 때와 동일한 속성'(httpOnly/secure/sameSite/path)을 줘야 한다.
// 특히 iOS Safari 는 속성이 다르면 쿠키를 실제로 지우지 않아, 만료된 rft 가 남아
// 다음 로그인을 방해(누적)한다 → 사용자가 수동으로 쿠키 삭제할 때까지 로그인 실패.
const CLEAR_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

// Capacitor 앱(iOS/Android)은 출처가 capacitor://localhost · http://localhost 라
// httpOnly refresh 쿠키가 교차출처로 취급돼 전송되지 않는다. 그래서 앱은 X-Client 헤더를
// 보내고, 서버는 이 요청에 한해 refreshToken 을 응답 body 로도 내려준다(웹은 지금대로 쿠키만).
// Plan v2 §5.2 — 추가·하위호환(웹 동작 무변경).
function isAppClient(req: Request): boolean {
  return req.headers['x-client']?.toString().endsWith('-app') ?? false;
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return {
      accessToken: result.accessToken,
      user: result.user,
      // 앱 전용: 쿠키를 못 쓰므로 refresh token 을 body 로도 전달 (웹은 미포함)
      ...(isAppClient(req) ? { refreshToken: result.refreshToken } : {}),
    };
  }

  @Post('refresh')
  @SkipThrottle()
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // 웹은 쿠키, 앱은 body 의 refreshToken 사용
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    try {
      const result = await this.authService.refresh(token);
      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      return {
        accessToken: result.accessToken,
        ...(isAppClient(req) ? { refreshToken: result.refreshToken } : {}),
      };
    } catch (err) {
      // 만료/무효 토큰 — 쿠키 즉시 정리 (iOS Safari 가 httpOnly 쿠키 영구 보관해
      // 사용자가 수동으로 쿠키 삭제할 때까지 로그인 못 하는 문제 해결)
      res.clearCookie(REFRESH_COOKIE, CLEAR_COOKIE_OPTIONS);
      throw err;
    }
  }

  /**
   * 쿠키 정리 전용 — 인증 불필요 (public).
   * Login 페이지 진입 시 클라이언트가 호출하여 만료된 refresh 쿠키를 안전하게 비운다.
   * 보안상 다른 정보는 노출/조작 안 함.
   */
  @Post('clear-cookie')
  @SkipThrottle()
  async clearCookie(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, CLEAR_COOKIE_OPTIONS);
    return { ok: true };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser('id') userId: string,
  ) {
    const token = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    await this.authService.logout(userId, token);
    res.clearCookie(REFRESH_COOKIE, CLEAR_COOKIE_OPTIONS);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async me(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }
}
