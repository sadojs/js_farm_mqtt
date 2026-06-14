import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZoneNote } from './entities/zone-note.entity';
import { HouseGroup } from '../groups/entities/house-group.entity';
import { User } from '../users/entities/user.entity';
import { ZoneNotesService } from './zone-notes.service';
import { ZoneNotesController } from './zone-notes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ZoneNote, HouseGroup, User])],
  controllers: [ZoneNotesController],
  providers: [ZoneNotesService],
})
export class ZoneNotesModule {}
