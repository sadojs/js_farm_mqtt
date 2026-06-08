import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SprayZone } from './entities/spray-zone.entity';
import { SprayProgram } from './entities/spray-program.entity';
import { SprayProduct } from './entities/spray-product.entity';
import { SprayEvent } from './entities/spray-event.entity';
import { SprayScheduleService } from './spray-schedule.service';
import { SprayScheduleController } from './spray-schedule.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SprayZone, SprayProgram, SprayProduct, SprayEvent]),
  ],
  controllers: [SprayScheduleController],
  providers: [SprayScheduleService],
})
export class SprayScheduleModule {}
