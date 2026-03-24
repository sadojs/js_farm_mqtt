import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('weather_data')
export class WeatherData {
  @PrimaryColumn({ type: 'timestamptz' })
  time: Date;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  temperature: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  humidity: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  precipitation: number | null;

  @Column({ name: 'wind_speed', type: 'decimal', precision: 5, scale: 2, nullable: true })
  windSpeed: number | null;

  @Column({ length: 20, default: 'clear' })
  condition: string;

  @Column({ type: 'int', nullable: true })
  nx: number | null;

  @Column({ type: 'int', nullable: true })
  ny: number | null;
}
