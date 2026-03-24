import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TuyaService } from './tuya.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TuyaProject } from '../../users/entities/tuya-project.entity';

class TestCredentialsDto {
  @IsString()
  accessId: string;

  @IsString()
  accessSecret: string;

  @IsString()
  endpoint: string;
}

@Controller('tuya')
@UseGuards(JwtAuthGuard)
export class TuyaController {
  constructor(
    private tuyaService: TuyaService,
    @InjectRepository(TuyaProject)
    private tuyaRepo: Repository<TuyaProject>,
  ) {}

  /**
   * 폼에서 입력한 크레덴셜로 직접 연결 테스트 (저장 불필요)
   */
  @Post('test-connection')
  async testConnection(@Body() dto: TestCredentialsDto) {
    return this.tuyaService.testConnection({
      accessId: dto.accessId,
      accessSecret: dto.accessSecret,
      endpoint: dto.endpoint,
    });
  }

  /**
   * 현재 사용자의 Tuya 디바이스 목록 조회 (DB에서 크레덴셜 읽음)
   */
  @Get('devices')
  async getDevices(@CurrentUser('id') userId: string) {
    const tuya = await this.tuyaRepo.findOne({ where: { userId } });
    if (!tuya) {
      return { success: false, message: 'Tuya 프로젝트가 설정되지 않았습니다.', devices: [] };
    }

    const credentials = {
      accessId: tuya.accessId,
      accessSecret: tuya.accessSecretEncrypted,
      endpoint: tuya.endpoint,
    };

    try {
      const result = await this.tuyaService.apiGet(
        credentials,
        '/v1.0/iot-01/associated-users/devices?last_row_key=&size=100',
      );
      return {
        success: result.success,
        devices: result.result?.devices || [],
        total: result.result?.total || 0,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.response?.data?.msg || err.message,
        devices: [],
      };
    }
  }
}
