import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ── 타입 ──

interface PositionEntry {
  level1: string; level2: string; level3: string;
  nx: number; ny: number;
}

interface ShortForecastItem {
  date: string;    // "내일", "모레", "글피"
  amSky?: string;  // 오전 하늘
  pmSky?: string;  // 오후 하늘
  minTemp?: number;
  maxTemp?: number;
  rainPct?: number;
}

interface MidForecast {
  regId: string;
  date: string;
  forecasts: Array<{
    day: number;
    minTemp?: number; maxTemp?: number;
    rainAmPct?: number; rainPmPct?: number;
    skyAm?: string; skyPm?: string;
  }>;
}

// ── 지역 코드 매핑 ──

const LAND_REG_MAP: Record<string, string> = {
  '서울': '11B00000', '인천': '11B00000', '경기': '11B00000',
  '강원': '11D10000',
  '대전': '11C20000', '세종': '11C20000', '충남': '11C20000', '충청남도': '11C20000',
  '충북': '11C10000', '충청북도': '11C10000',
  '광주': '11F20000', '전남': '11F20000', '전라남도': '11F20000',
  '전북': '11F10000', '전라북도': '11F10000',
  '대구': '11H10000', '경북': '11H10000', '경상북도': '11H10000',
  '부산': '11H20000', '울산': '11H20000', '경남': '11H20000', '경상남도': '11H20000',
  '제주': '11G00000',
};

const TEMP_REG_MAP: Record<string, string> = {
  '서울': '11B10101', '인천': '11B20201', '수원': '11B20601',
  '대전': '11C20401', '세종': '11C20404', '청주': '11C10301',
  '광주': '11F20501', '전주': '11F10201',
  '대구': '11H10701', '부산': '11H20201', '울산': '11H20101',
  '강릉': '11D20501', '춘천': '11D10301',
  '제주': '11G00201',
  '서산': '11C20101', '당진': '11C20102', '태안': '11C20103',
  '홍성': '11C20104', '예산': '11C20105', '보령': '11C20201',
  '천안': '11C20301', '아산': '11C20302',
};

// 하늘상태 코드 → 텍스트
const SKY_MAP: Record<string, string> = { '1': '맑음', '3': '구름많음', '4': '흐림' };
const PTY_MAP: Record<string, string> = { '1': '비', '2': '비/눈', '3': '눈', '4': '소나기' };

@Injectable()
export class MidForecastService {
  private readonly logger = new Logger(MidForecastService.name);
  private readonly midEndpoint = 'https://apis.data.go.kr/1360000/MidFcstInfoService';
  private readonly shortEndpoint = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';
  private positions: PositionEntry[] = [];

  constructor(private configService: ConfigService) {
    try {
      const filePath = path.join(process.cwd(), 'src/modules/dashboard/position.json');
      this.positions = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.logger.log(`위치 데이터 로드: ${this.positions.length}개 지역`);
    } catch {
      this.logger.warn('position.json 로드 실패 — 단기예보 사용 불가');
    }
  }

  // ══════════════════════════════════════════
  //  단기예보 (오늘~3일, 읍면동 5km 격자)
  // ══════════════════════════════════════════

  async getShortForecast(address: string): Promise<{ speech: string; data: ShortForecastItem[] | null }> {
    const pos = this.findPosition(address);
    if (!pos) {
      return { speech: '해당 지역의 단기 예보를 찾을 수 없습니다.', data: null };
    }

    const serviceKey = this.getServiceKey();
    const { baseDate, baseTime } = this.getShortBaseDateTime();

    try {
      const { data } = await axios.get(this.shortEndpoint, {
        params: {
          serviceKey, pageNo: 1, numOfRows: 1000, dataType: 'JSON',
          base_date: baseDate, base_time: baseTime,
          nx: pos.nx, ny: pos.ny,
        },
        timeout: 10000,
      });

      const items = data?.response?.body?.items?.item;
      if (!items || items.length === 0) {
        return { speech: '단기 예보 데이터가 없습니다.', data: null };
      }

      const forecast = this.parseShortForecast(items);
      const speech = this.formatShortSpeech(forecast);
      return { speech, data: forecast };
    } catch (error) {
      this.logger.error(`단기 예보 조회 실패: ${error.message}`);
      return { speech: '단기 예보를 가져오는데 실패했습니다.', data: null };
    }
  }

  private parseShortForecast(items: any[]): ShortForecastItem[] {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kst.toISOString().slice(0, 10).replace(/-/g, '');

    // 날짜별 그룹핑
    const byDate: Record<string, Record<string, any>> = {};
    for (const item of items) {
      const d = item.fcstDate;
      if (!byDate[d]) byDate[d] = {};
      const key = `${item.category}_${item.fcstTime}`;
      byDate[d][key] = item.fcstValue;
      // 카테고리별 최소/최대 저장
      if (item.category === 'TMN') byDate[d]['TMN'] = parseFloat(item.fcstValue);
      if (item.category === 'TMX') byDate[d]['TMX'] = parseFloat(item.fcstValue);
    }

    const dates = Object.keys(byDate).sort();
    const result: ShortForecastItem[] = [];

    for (const d of dates) {
      const dayData = byDate[d];
      const diff = Math.round((new Date(d.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getTime() -
        new Date(todayStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getTime()) / 86400000);

      const label = diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === 2 ? '모레' : `${diff}일 후`;

      // 오전(06~12) / 오후(12~18) 하늘 대표값
      const amSky = dayData['SKY_0900'] || dayData['SKY_1200'];
      const pmSky = dayData['SKY_1500'] || dayData['SKY_1800'];
      const amPty = dayData['PTY_0900'] || dayData['PTY_1200'];
      const pmPty = dayData['PTY_1500'] || dayData['PTY_1800'];

      // 강수확률 최대값
      const pops = Object.entries(dayData)
        .filter(([k]) => k.startsWith('POP_'))
        .map(([, v]) => parseInt(v as string, 10))
        .filter((v) => !isNaN(v));
      const maxPop = pops.length > 0 ? Math.max(...pops) : undefined;

      const skyText = (pty: string, sky: string) => {
        if (pty && pty !== '0') return PTY_MAP[pty] || '강수';
        return SKY_MAP[sky] || undefined;
      };

      result.push({
        date: label,
        amSky: skyText(amPty, amSky),
        pmSky: skyText(pmPty, pmSky),
        minTemp: dayData['TMN'],
        maxTemp: dayData['TMX'],
        rainPct: maxPop,
      });
    }

    return result;
  }

  private formatShortSpeech(forecast: ShortForecastItem[]): string {
    if (forecast.length === 0) return '단기 예보 데이터가 없습니다.';

    const lines: string[] = ['단기 예보입니다.'];
    for (const f of forecast) {
      const parts: string[] = [f.date];
      if (f.amSky && f.pmSky && f.amSky !== f.pmSky) {
        parts.push(`오전 ${f.amSky}, 오후 ${f.pmSky}`);
      } else if (f.amSky || f.pmSky) {
        parts.push(f.amSky || f.pmSky!);
      }
      if (f.minTemp != null && f.maxTemp != null) {
        parts.push(`${f.minTemp}도에서 ${f.maxTemp}도`);
      }
      if (f.rainPct != null && f.rainPct > 20) {
        parts.push(`강수확률 ${f.rainPct}%`);
      }
      lines.push(parts.join(', '));
    }
    return lines.join('. ');
  }

  /** 단기예보 발표시각 (02,05,08,11,14,17,20,23시) 중 가장 최근 */
  private getShortBaseDateTime(): { baseDate: string; baseTime: string } {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h = kst.getUTCHours();
    const m = kst.getUTCMinutes();
    const bases = [23, 20, 17, 14, 11, 8, 5, 2];

    let baseH = 2;
    for (const b of bases) {
      if (h > b || (h === b && m >= 10)) { baseH = b; break; }
    }

    let baseDate = kst.toISOString().slice(0, 10).replace(/-/g, '');
    if (baseH === 23 && h < 23) {
      // 자정 직후: 전날 23시
      const yesterday = new Date(kst);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      baseDate = yesterday.toISOString().slice(0, 10).replace(/-/g, '');
    }

    return { baseDate, baseTime: String(baseH).padStart(2, '0') + '00' };
  }

  private findPosition(address: string): PositionEntry | null {
    const norm = address.toLowerCase().replace(/\s+/g, '').replace(/[().,-]/g, '');
    let best: PositionEntry | null = null;
    let bestScore = 0;

    for (const entry of this.positions) {
      let score = 0;
      const l1 = entry.level1.toLowerCase().replace(/\s+/g, '');
      const l2 = entry.level2.toLowerCase().replace(/\s+/g, '');
      const l3 = entry.level3.toLowerCase().replace(/\s+/g, '');
      if (l1 && norm.includes(l1)) score += 10;
      if (l2 && norm.includes(l2)) score += 30;
      if (l3 && norm.includes(l3)) score += 60;
      if (score > bestScore) { best = entry; bestScore = score; }
    }
    return best;
  }

  // ══════════════════════════════════════════
  //  중기예보 (4~10일, 광역 권역별)
  // ══════════════════════════════════════════

  async getMidForecast(address: string): Promise<{ speech: string; data: MidForecast | null }> {
    const serviceKey = this.getServiceKey();
    const landRegId = this.findLandRegId(address);
    const tempRegId = this.findTempRegId(address);

    if (!landRegId) {
      return { speech: '해당 지역의 중기 예보를 찾을 수 없습니다.', data: null };
    }

    try {
      let tmFc = this.getTmFc();
      let [landRes, tempRes] = await Promise.all([
        this.fetchMidLandFcst(serviceKey, landRegId, tmFc),
        tempRegId ? this.fetchMidTa(serviceKey, tempRegId, tmFc) : null,
      ]);

      if (!landRes && tmFc.endsWith('0600')) {
        const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const dateStr = kst.toISOString().slice(0, 10).replace(/-/g, '');
        tmFc = `${dateStr}1800`;
        [landRes, tempRes] = await Promise.all([
          this.fetchMidLandFcst(serviceKey, landRegId, tmFc),
          tempRegId ? this.fetchMidTa(serviceKey, tempRegId, tmFc) : null,
        ]);
      }

      const forecast = this.mergeForecast(landRegId, tmFc, landRes, tempRes);
      const speech = this.formatMidSpeech(forecast);
      return { speech, data: forecast };
    } catch (error) {
      this.logger.error(`중기 예보 조회 실패: ${error.message}`);
      return { speech: '중기 예보를 가져오는데 실패했습니다.', data: null };
    }
  }

  private getServiceKey(): string {
    return this.configService.get<string>('KMA_MID_API_KEY')
      || this.configService.get<string>('KMA_SERVICE_KEY')
      || this.configService.get<string>('KMA_API_KEY')
      || 'Ovj/Y+kq2KuEXQDUmEBRg4ekq4bR2xjBSmwLU0Atp4r2ZJeOKhMBjap2M5J34fLoj5VM9w6VA/ySVbjAtgX9SQ==';
  }

  private getTmFc(): string {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h = kst.getUTCHours();
    const dateStr = kst.toISOString().slice(0, 10).replace(/-/g, '');
    if (h >= 18) return `${dateStr}1800`;
    if (h >= 6) return `${dateStr}0600`;
    const yesterday = new Date(kst);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return `${yesterday.toISOString().slice(0, 10).replace(/-/g, '')}1800`;
  }

  private findLandRegId(address: string): string | null {
    for (const [key, regId] of Object.entries(LAND_REG_MAP)) {
      if (address.includes(key)) return regId;
    }
    return null;
  }

  private findTempRegId(address: string): string | null {
    for (const [key, regId] of Object.entries(TEMP_REG_MAP)) {
      if (address.includes(key)) return regId;
    }
    return null;
  }

  private async fetchMidLandFcst(serviceKey: string, regId: string, tmFc: string): Promise<any> {
    const { data } = await axios.get(`${this.midEndpoint}/getMidLandFcst`, {
      params: { serviceKey, pageNo: 1, numOfRows: 10, dataType: 'JSON', regId, tmFc },
      timeout: 10000,
    });
    return data?.response?.body?.items?.item?.[0] || null;
  }

  private async fetchMidTa(serviceKey: string, regId: string, tmFc: string): Promise<any> {
    const { data } = await axios.get(`${this.midEndpoint}/getMidTa`, {
      params: { serviceKey, pageNo: 1, numOfRows: 10, dataType: 'JSON', regId, tmFc },
      timeout: 10000,
    });
    return data?.response?.body?.items?.item?.[0] || null;
  }

  private mergeForecast(regId: string, tmFc: string, land: any, temp: any): MidForecast {
    const forecasts: MidForecast['forecasts'] = [];
    for (let day = 3; day <= 10; day++) {
      const entry: MidForecast['forecasts'][0] = { day };
      if (temp) { entry.minTemp = temp[`taMin${day}`]; entry.maxTemp = temp[`taMax${day}`]; }
      if (land) {
        entry.rainAmPct = land[`rnSt${day}Am`] ?? land[`rnSt${day}`];
        entry.rainPmPct = land[`rnSt${day}Pm`] ?? land[`rnSt${day}`];
        entry.skyAm = land[`wf${day}Am`] ?? land[`wf${day}`];
        entry.skyPm = land[`wf${day}Pm`] ?? land[`wf${day}`];
      }
      forecasts.push(entry);
    }
    return { regId, date: tmFc, forecasts };
  }

  private formatMidSpeech(forecast: MidForecast): string {
    const validDays = forecast.forecasts.filter(
      (f) => f.skyAm || f.skyPm || f.minTemp != null || f.rainAmPct != null,
    );
    if (validDays.length === 0) return '중기 예보 데이터가 없습니다.';

    const lines: string[] = ['중기 예보입니다.'];
    for (const f of validDays) {
      const parts: string[] = [`${f.day}일 후`];
      if (f.skyAm) parts.push(f.skyAm);
      if (f.minTemp != null && f.maxTemp != null) parts.push(`${f.minTemp}도에서 ${f.maxTemp}도`);
      if (f.rainAmPct != null && f.rainAmPct > 20) {
        parts.push(`강수확률 ${Math.max(f.rainAmPct, f.rainPmPct ?? 0)}%`);
      }
      lines.push(parts.join(', '));
    }
    return lines.join('. ');
  }
}
