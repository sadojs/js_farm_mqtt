import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZoneNotesService } from './zone-notes.service';
import { CreateZoneNoteDto, UpdateZoneNoteDto } from './dto/zone-note.dto';

@Controller('zone-notes')
@UseGuards(JwtAuthGuard)
export class ZoneNotesController {
  constructor(private readonly service: ZoneNotesService) {}

  @Get()
  list(@CurrentUser() user: any, @Query('zoneId') zoneId: string) {
    return this.service.list(user, zoneId);
  }

  @Get('counts')
  counts(@CurrentUser() user: any) {
    return this.service.counts(user);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateZoneNoteDto) {
    return this.service.create(user, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateZoneNoteDto) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
