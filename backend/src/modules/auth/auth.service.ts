import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { TuyaProject } from '../users/entities/tuya-project.entity';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepo: Repository<User>,
    @InjectRepository(TuyaProject)
    private tuyaRepo: Repository<TuyaProject>,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('비활성화된 계정입니다.');
    }

    const tuyaProject = await this.tuyaRepo.findOne({ where: { userId: user.id } });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      parentUserId: user.parentUserId || null,
    };

    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: '1h' }),
      refreshToken: this.jwtService.sign(payload, { expiresIn: '7d' }),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        parentUserId: user.parentUserId || null,
        address: user.address,
        tuyaProject: tuyaProject
          ? {
              name: tuyaProject.name,
              accessId: tuyaProject.accessId,
              endpoint: tuyaProject.endpoint,
              projectId: tuyaProject.projectId,
              enabled: tuyaProject.enabled,
            }
          : null,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload>(refreshToken);
      const newPayload: JwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        parentUserId: payload.parentUserId || null,
      };
      return {
        accessToken: this.jwtService.sign(newPayload, { expiresIn: '1h' }),
        refreshToken: this.jwtService.sign(newPayload, { expiresIn: '7d' }),
      };
    } catch {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }
  }

  async getMe(userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const tuyaProject = await this.tuyaRepo.findOne({ where: { userId: user.id } });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      parentUserId: user.parentUserId || null,
      address: user.address,
      tuyaProject: tuyaProject
        ? {
            name: tuyaProject.name,
            accessId: tuyaProject.accessId,
            endpoint: tuyaProject.endpoint,
            projectId: tuyaProject.projectId,
            enabled: tuyaProject.enabled,
          }
        : null,
    };
  }
}
