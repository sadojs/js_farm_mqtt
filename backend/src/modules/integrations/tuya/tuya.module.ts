import { Module } from '@nestjs/common';
import { TuyaService } from './tuya.service';
import { TuyaController } from './tuya.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TuyaProject } from '../../users/entities/tuya-project.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TuyaProject])],
  controllers: [TuyaController],
  providers: [TuyaService],
  exports: [TuyaService],
})
export class TuyaModule {}
