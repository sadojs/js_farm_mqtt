import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'farm_admin' | 'farm_user';
  parentUserId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'smart-farm-jwt-secret-change-me'),
    });
  }

  async validate(payload: JwtPayload) {
    return { id: payload.sub, email: payload.email, role: payload.role, parentUserId: payload.parentUserId || null };
  }
}
