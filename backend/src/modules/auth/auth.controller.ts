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

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @SkipThrottle()
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    try {
      const result = await this.authService.refresh(token);
      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      return { accessToken: result.accessToken };
    } catch (err) {
      // 만료/무효 토큰 — 쿠키 즉시 정리 (iOS Safari 가 httpOnly 쿠키 영구 보관해
      // 사용자가 수동으로 쿠키 삭제할 때까지 로그인 못 하는 문제 해결)
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
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
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
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
    const token = req.cookies?.[REFRESH_COOKIE];
    await this.authService.logout(userId, token);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  async me(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }
}
