import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokenRepo: Repository<RefreshToken>,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOne({ where: { username: dto.username.toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException('사용자명 또는 비밀번호가 올바르지 않습니다.');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('사용자명 또는 비밀번호가 올바르지 않습니다.');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('비활성화된 계정입니다.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      parentUserId: user.parentUserId || null,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: REFRESH_TOKEN_TTL });

    await this.storeRefreshToken(user.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        parentUserId: user.parentUserId || null,
        address: user.address,
      },
    };
  }

  async refresh(rawToken: string | undefined) {
    if (!rawToken) {
      throw new UnauthorizedException('리프레시 토큰이 없습니다.');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(rawToken);
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    // DB에서 hash 비교 (사용자당 최대 5개 토큰 → 성능 보장)
    const validRecord = await this.findMatchingToken(payload.sub, rawToken);
    if (!validRecord) {
      throw new UnauthorizedException('만료되었거나 유효하지 않은 토큰입니다.');
    }

    // 기존 토큰 삭제 (rotation)
    await this.refreshTokenRepo.delete(validRecord.id);

    const newPayload: JwtPayload = {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      parentUserId: payload.parentUserId || null,
    };

    const accessToken = this.jwtService.sign(newPayload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = this.jwtService.sign(newPayload, { expiresIn: REFRESH_TOKEN_TTL });

    await this.storeRefreshToken(payload.sub, refreshToken);

    return { accessToken, refreshToken };
  }

  async logout(userId: string, rawToken: string | undefined) {
    if (rawToken) {
      const record = await this.findMatchingToken(userId, rawToken);
      if (record) {
        await this.refreshTokenRepo.delete(record.id);
      }
    }
    // 만료된 토큰 정리
    await this.refreshTokenRepo.delete({ expiresAt: LessThan(new Date()) });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredTokens(): Promise<void> {
    const result = await this.refreshTokenRepo.delete({
      expiresAt: LessThan(new Date()),
    });
    this.logger.log(`Cleanup expired refresh tokens: ${result.affected ?? 0} removed`);
  }

  async getMe(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      parentUserId: user.parentUserId || null,
      address: user.address,
    };
  }

  private async storeRefreshToken(userId: string, rawToken: string) {
    // 사용자당 최대 5개 토큰만 유지 (멀티 디바이스 허용, 무제한 방지)
    const existing = await this.refreshTokenRepo.find({ where: { userId } });
    if (existing.length >= 5) {
      // 가장 오래된 토큰 삭제
      const oldest = existing.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      await this.refreshTokenRepo.delete(oldest.id);
    }

    const tokenHash = await bcrypt.hash(rawToken, 8);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({ userId, tokenHash, expiresAt }),
    );
  }

  private async findMatchingToken(userId: string, rawToken: string): Promise<RefreshToken | null> {
    const records = await this.refreshTokenRepo.find({ where: { userId } });
    for (const record of records) {
      if (record.expiresAt < new Date()) {
        await this.refreshTokenRepo.delete(record.id);
        continue;
      }
      const match = await bcrypt.compare(rawToken, record.tokenHash);
      if (match) return record;
    }
    return null;
  }
}
