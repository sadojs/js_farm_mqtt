import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

/**
 * KMA ASOS 기후통계 API를 통해 과거 기온 데이터를 가져와
 * climate_normals 테이블에 월별 평균 기온을 캐시합니다.
 *
 * KMA ASOS API: https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList
 * - dataCd=ASOS, dateCd=DAY
 * - avgTa: 일 평균 기온
 */
@Injectable()
export class KmaClimateService {
  private readonly logger = new Logger(KmaClimateService.name);
  private readonly KMA_ASOS_BASE =
    'https://apis.data.go.kr/1360000/AsosDalyInfoService';
  // 공공데이터포털 인증키: Encoding 키를 그대로 사용
  // (fetch가 URL을 다시 인코딩하지 않도록 URL 문자열을 직접 조립)
  private readonly SERVICE_KEY =
    process.env.KMA_ASOS_KEY ||
    process.env.KMA_SERVICE_KEY ||
    process.env.KMA_API_KEY ||
    '';

  // (nx, ny) → ASOS 관측소 ID 근사 매핑 (주요 관측소)
  // https://www.data.go.kr/data/15057210/openapi.do
  private readonly STATION_MAP: Array<{ nx: number; ny: number; id: string; name: string }> = [
    { nx: 60, ny: 127, id: '108', name: '서울' },
    { nx: 89, ny: 90,  id: '119', name: '수원' },
    { nx: 73, ny: 134, id: '98',  name: '동두천' },
    { nx: 87, ny: 141, id: '201', name: '양평' },
    { nx: 77, ny: 140, id: '202', name: '이천' },
    { nx: 89, ny: 142, id: '114', name: '원주' },   // 횡성 인근 최근접 ASOS 관측소
    { nx: 95, ny: 154, id: '99',  name: '강릉' },
    { nx: 91, ny: 126, id: '112', name: '인천' },
    { nx: 100, ny: 106, id: '232', name: '청주' },
    { nx: 102, ny: 84,  id: '143', name: '대전' },
    { nx: 102, ny: 71,  id: '156', name: '전주' },
    { nx: 97, ny: 74,   id: '245', name: '광주' },
    { nx: 128, ny: 97,  id: '238', name: '대구' },
    { nx: 129, ny: 60,  id: '192', name: '진주' },
    { nx: 129, ny: 76,  id: '136', name: '부산' },
    { nx: 124, ny: 38,  id: '184', name: '제주' },
  ];

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 가장 가까운 ASOS 관측소 ID 반환
   */
  private nearestStation(nx: number, ny: number): { id: string; name: string } {
    let best = this.STATION_MAP[0];
    let bestDist = Infinity;
    for (const st of this.STATION_MAP) {
      const d = Math.hypot(st.nx - nx, st.ny - ny);
      if (d < bestDist) { bestDist = d; best = st; }
    }
    return best;
  }

  /**
   * nx/ny 위치의 기후 정규값이 캐시되어 있는지 확인
   * 30일 이내 갱신이면 재사용
   */
  async isCached(nx: number, ny: number): Promise<boolean> {
    const rows = await this.dataSource.query<{ last_fetched: Date }[]>(
      `SELECT last_fetched FROM climate_normals_meta WHERE nx = $1 AND ny = $2`,
      [nx, ny],
    );
    if (rows.length === 0) return false;
    const age = Date.now() - rows[0].last_fetched.getTime();
    return age < 30 * 24 * 3600 * 1000; // 30일
  }

  /**
   * 월별 기후 정규값 조회 (없으면 내장 기본값 반환)
   * 반환: month(1-12) → avg_temp
   */
  async getMonthlyNormals(nx: number, ny: number): Promise<Record<number, number>> {
    const rows = await this.dataSource.query<{ month: number; avg_temp: string }[]>(
      `SELECT month, avg_temp FROM climate_normals WHERE nx = $1 AND ny = $2 ORDER BY month`,
      [nx, ny],
    );

    if (rows.length >= 12) {
      return Object.fromEntries(rows.map((r) => [Number(r.month), parseFloat(r.avg_temp)]));
    }

    // 캐시 없으면 KMA ASOS로 fetch 시도 (비동기 백그라운드)
    this.fetchAndCacheNormals(nx, ny).catch((e) =>
      this.logger.warn(`기후 정규값 fetch 실패 [${nx},${ny}]: ${e.message}`),
    );

    // 즉시: 내장 한국 중부 기준 월별 평균 기온 (°C) 반환
    return this.builtinNormals(nx, ny);
  }

  /**
   * KMA ASOS API → 과거 3년치 일별 기온 → 월별 평균 계산 → DB 저장
   */
  async fetchAndCacheNormals(nx: number, ny: number): Promise<void> {
    const station = this.nearestStation(nx, ny);
    this.logger.log(`기후 정규값 수집 시작 [${station.name} #${station.id}]`);

    const monthlySum: Record<number, { total: number; count: number }> = {};
    for (let m = 1; m <= 12; m++) monthlySum[m] = { total: 0, count: 0 };

    const today = new Date();
    const years = [
      today.getFullYear() - 1,
      today.getFullYear() - 2,
      today.getFullYear() - 3,
    ];

    for (const year of years) {
      const startDt = `${year}0101`;
      const endDt = `${year}1231`;
      try {
        // 공공데이터포털 인증키는 Encoding 키를 URL에 직접 삽입
        // (URLSearchParams 사용 시 이중 인코딩 발생)
        const queryString = [
          `serviceKey=${this.SERVICE_KEY}`,
          `pageNo=1`,
          `numOfRows=366`,
          `dataType=JSON`,
          `dataCd=ASOS`,
          `dateCd=DAY`,
          `startDt=${startDt}`,
          `endDt=${endDt}`,
          `stnIds=${station.id}`,
        ].join('&');
        const reqUrl = `${this.KMA_ASOS_BASE}/getWthrDataList?${queryString}`;

        const res = await fetch(reqUrl);
        if (!res.ok) { this.logger.warn(`ASOS API ${year} HTTP ${res.status}`); continue; }
        const json = await res.json() as any;

        const items: any[] = json?.response?.body?.items?.item ?? [];
        for (const item of items) {
          const avgTa = parseFloat(item.avgTa);
          if (isNaN(avgTa)) continue;
          const month = parseInt(item.tm?.substring(4, 6), 10);
          if (month >= 1 && month <= 12) {
            monthlySum[month].total += avgTa;
            monthlySum[month].count++;
          }
        }
      } catch (e) {
        this.logger.warn(`ASOS ${year} 오류: ${e.message}`);
      }
    }

    // DB 저장
    const hasData = Object.values(monthlySum).some((v) => v.count > 0);
    if (!hasData) {
      this.logger.warn(`ASOS 데이터 없음 [${station.name}] → 내장값 저장`);
      await this.saveBuiltinNormals(nx, ny);
      return;
    }

    for (let m = 1; m <= 12; m++) {
      const { total, count } = monthlySum[m];
      const avgTemp = count > 0 ? total / count : this.builtinNormals(nx, ny)[m];
      await this.dataSource.query(
        `INSERT INTO climate_normals (nx, ny, month, avg_temp, data_years, source, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'kma_asos', NOW())
         ON CONFLICT (nx, ny, month) DO UPDATE
           SET avg_temp = $4, data_years = $5, source = 'kma_asos', updated_at = NOW()`,
        [nx, ny, m, Math.round(avgTemp * 10) / 10, years.length],
      );
    }

    await this.dataSource.query(
      `INSERT INTO climate_normals_meta (nx, ny, last_fetched, station_id)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (nx, ny) DO UPDATE SET last_fetched = NOW(), station_id = $3`,
      [nx, ny, station.id],
    );

    this.logger.log(`기후 정규값 저장 완료 [${station.name}]`);
  }

  /**
   * weather_data 테이블에서 기후 정규값 계산 (충분한 데이터 있을 때)
   */
  async computeFromWeatherData(nx: number, ny: number, userId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ month: number; avg_temp: string; cnt: string }[]>(
      `SELECT
         EXTRACT(MONTH FROM time)::int AS month,
         AVG(temperature) AS avg_temp,
         COUNT(DISTINCT DATE_TRUNC('day', time)) AS cnt
       FROM weather_data
       WHERE nx = $1 AND ny = $2
         AND time >= NOW() - INTERVAL '3 years'
       GROUP BY 1
       HAVING COUNT(DISTINCT DATE_TRUNC('day', time)) >= 20
       ORDER BY 1`,
      [nx, ny],
    );

    if (rows.length < 8) return false; // 8개월 이상 데이터 있을 때만

    for (const r of rows) {
      await this.dataSource.query(
        `INSERT INTO climate_normals (nx, ny, month, avg_temp, data_years, source, updated_at)
         VALUES ($1, $2, $3, $4, 1, 'weather_data', NOW())
         ON CONFLICT (nx, ny, month) DO UPDATE
           SET avg_temp = $4, source = 'weather_data', updated_at = NOW()`,
        [nx, ny, r.month, Math.round(parseFloat(r.avg_temp) * 10) / 10],
      );
    }

    return true;
  }

  private async saveBuiltinNormals(nx: number, ny: number): Promise<void> {
    const normals = this.builtinNormals(nx, ny);
    for (const [m, temp] of Object.entries(normals)) {
      await this.dataSource.query(
        `INSERT INTO climate_normals (nx, ny, month, avg_temp, data_years, source, updated_at)
         VALUES ($1, $2, $3, $4, 0, 'builtin', NOW())
         ON CONFLICT (nx, ny, month) DO NOTHING`,
        [nx, ny, Number(m), temp],
      );
    }
  }

  /**
   * 내장 한국 중부 월별 평균 기온 (기상청 30년 평년값 기준)
   * 위도/경도에 따라 남부/북부 보정
   */
  private builtinNormals(nx: number, ny: number): Record<number, number> {
    // ny가 높을수록 북쪽 (추움), 낮을수록 남부/제주 (따뜻함)
    // ny 기준: 제주(38) ~ 강릉(154)
    const latOffset = Math.max(-3, Math.min(3, (ny - 100) * 0.03)); // 대략 ±3°C 보정

    const central = {
      1: -2.5,  2: -0.5,  3: 5.5,   4: 12.5,
      5: 18.0,  6: 22.5,  7: 25.5,  8: 26.0,
      9: 21.0,  10: 14.5, 11: 7.0,  12: 1.0,
    };

    return Object.fromEntries(
      Object.entries(central).map(([m, t]) => [Number(m), Math.round((t - latOffset) * 10) / 10]),
    );
  }
}
