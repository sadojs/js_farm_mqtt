import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { VoiceService, VoiceResponse } from './voice.service';

@Controller('voice')
export class VoiceController {
  constructor(private voiceService: VoiceService) {}

  @Post('command')
  @UseGuards(JwtAuthGuard)
  async handleCommand(
    @Req() req,
    @Body() body: { text: string },
  ): Promise<VoiceResponse> {
    return this.voiceService.execute(req.user, body.text);
  }
}
