import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeatherData } from './weather-data.entity';
import { DashboardService } from '../dashboard/dashboard.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class WeatherCollectorService {
  private readonly logger = new Logger(WeatherCollectorService.name);

  constructor(
    @InjectRepository(WeatherData)
    private readonly weatherRepo: Repository<WeatherData>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dashboardService: DashboardService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async collectWeatherData() {
    const users = await this.userRepo.find({
      where: { status: 'active' },
    });
    // 날씨는 농장 단위 — 농장 사용자는 소속 농장(부모)의 날씨를 쓰므로 수집하지 않는다
    const usersWithAddress = users.filter((u) => u.address && u.role !== 'farm_user');

    const now = new Date();
    now.setMinutes(0, 0, 0);

    let collected = 0;

    for (const user of usersWithAddress) {
      try {
        const exists = await this.weatherRepo.findOne({
          where: { time: now, userId: user.id },
        });
        if (exists) continue;

        const result = await this.dashboardService.getWeatherForUser(user.id);

        const weatherData = this.weatherRepo.create({
          time: now,
          userId: user.id,
          temperature: result.weather.temperature,
          humidity: result.weather.humidity,
          precipitation: result.weather.precipitation,
          windSpeed: result.weather.windSpeed,
          condition: result.weather.condition,
          nx: result.location.nx,
          ny: result.location.ny,
        });
        await this.weatherRepo.save(weatherData);
        collected++;
      } catch (err) {
        this.logger.warn(
          `날씨 수집 실패 [${user.id}]: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `날씨 수집 완료: ${collected}/${usersWithAddress.length}명`,
    );
  }
}
