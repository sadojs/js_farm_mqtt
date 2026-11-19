import { Injectable, Logger } from '@nestjs/common';
import { EventsGateway } from '../gateway/events.gateway';

/**
 * 장치 목표 상태 중재기 (1단계).
 *
 * 장치에 명령을 내리려는 주체(룰·비·고온·방재·수동…)는 "이 장치를 이렇게 하고 싶다"는 요청(claim)을
 * 여기에 등록하고, 같은 장치에 서로 반대되는 요청이 있으면 우선순위 표로 승자를 정한다.
 *
 * 1단계 범위: 자동화 룰끼리의 충돌(R3·우선순위 역전)을 이 표로 해결하고, 룰끼리 반대로 제어하면
 * 사용자에게 알려 한쪽을 비활성화할지 묻는다. 비·고온·방재·비상정지·수동은 아직 기존 방식으로
 * 룰보다 먼저 처리되며(= 표의 위쪽), 이후 단계에서 요청 등록 방식으로 옮긴다.
 */

/** 요청 주체. 숫자가 작을수록 우선한다. */
export type ArbiterSource =
  | 'emergency' | 'protection' | 'rain' | 'high_temp'
  | 'manual' | 'irrigation_timer' | 'rule' | 'backup_schedule';

export const SOURCE_RANK: Record<ArbiterSource, number> = {
  emergency: 1,
  protection: 2,
  rain: 3,
  high_temp: 4,
  manual: 5,
  irrigation_timer: 6,
  rule: 7,
  backup_schedule: 8,
};

export const SOURCE_LABEL: Record<ArbiterSource, string> = {
  emergency: '비상 정지',
  protection: '방재 모드',
  rain: '비 감지 닫힘',
  high_temp: '고온 강제열림',
  manual: '수동 조작',
  irrigation_timer: '관수 타이머',
  rule: '자동화 룰',
  backup_schedule: '센서 끊김 시간표',
};

/** 방재는 개폐기·유동팬만 다룬다 — 관수 장비와는 서로 영향이 없다(별개). */
export const PROTECTION_DEVICE_CLASSES = ['opener', 'fan'] as const;

export type Want = 'on' | 'off' | 'open' | 'close';

export interface ClaimInput {
  /** 장치 키 — 개폐기는 열림/닫힘 쌍을 하나로 묶은 키(pairKey), 그 밖은 장치 id */
  deviceKey: string;
  source: ArbiterSource;
  /** 요청자 식별자(룰이면 룰 id) */
  key: string;
  want: Want;
  /** 같은 주체끼리의 순위(룰 priority — 클수록 우선) */
  rulePriority?: number;
  /** 사용자에게 보일 이름(룰 이름) */
  label: string;
  /** 알림·팝업을 받을 소유자 */
  userId: string;
  deviceName?: string;
}

export interface Claim extends ClaimInput {
  rulePriority: number;
  since: number;
  expiresAt: number;
}

export interface ArbiterConflict {
  id: string;
  deviceKey: string;
  deviceName: string;
  userId: string;
  winner: { ruleId: string; name: string; want: Want; priority: number };
  loser: { ruleId: string; name: string; want: Want; priority: number };
  createdAt: string;
}

export interface ClaimDecision {
  allowed: boolean;
  /** 거부됐다면 이긴 요청 */
  blockedBy?: Claim;
  /** 새로 생겨난 룰끼리의 충돌 */
  conflict?: ArbiterConflict;
}

/** 요청이 갱신되지 않으면(룰이 더는 동작하지 않으면) 이 시간 뒤 자동으로 사라진다. */
const CLAIM_TTL_MS = 150_000;
/** "그대로 두기"를 고른 충돌은 이 시간 동안 다시 묻지 않는다. */
const DISMISS_MS = 24 * 60 * 60 * 1000;

const WANT_KO: Record<Want, string> = { on: '켜기', off: '끄기', open: '열기', close: '닫기' };
export const wantLabel = (w: Want) => WANT_KO[w];

@Injectable()
export class DeviceArbiterService {
  private readonly logger = new Logger(DeviceArbiterService.name);
  private readonly claims = new Map<string, Claim>();
  private readonly conflicts = new Map<string, ArbiterConflict>();
  /** 충돌 id → 다시 묻기 시작할 시각 */
  private readonly dismissedUntil = new Map<string, number>();

  constructor(private readonly eventsGateway: EventsGateway) {}

  private static claimId(c: { deviceKey: string; source: string; key: string }) {
    return `${c.deviceKey}|${c.source}|${c.key}`;
  }

  /** a 가 b 보다 우선하면 음수 */
  static compare(a: Claim, b: Claim): number {
    if (SOURCE_RANK[a.source] !== SOURCE_RANK[b.source]) return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (a.rulePriority !== b.rulePriority) return b.rulePriority - a.rulePriority;
    if (a.since !== b.since) return a.since - b.since;
    return a.key < b.key ? -1 : 1;
  }

  private purge(now = Date.now()) {
    for (const [id, c] of this.claims) if (c.expiresAt <= now) this.claims.delete(id);
    // 양쪽 요청이 모두 살아 있지 않은 충돌은 해소된 것
    for (const [id, cf] of this.conflicts) {
      const alive = (ruleId: string) => [...this.claims.values()].some(
        (c) => c.deviceKey === cf.deviceKey && c.key === ruleId);
      if (!alive(cf.winner.ruleId) || !alive(cf.loser.ruleId)) this.conflicts.delete(id);
    }
  }

  /**
   * 요청을 등록·갱신하고 이 요청이 지금 따라질 수 있는지 돌려준다.
   * 반대 상태를 원하는 더 높은 순위의 요청이 있으면 allowed=false.
   */
  claim(input: ClaimInput): ClaimDecision {
    const now = Date.now();
    this.purge(now);
    const id = DeviceArbiterService.claimId(input);
    const prev = this.claims.get(id);
    const self: Claim = {
      ...input,
      rulePriority: input.rulePriority ?? 0,
      since: prev && prev.want === input.want ? prev.since : now,
      expiresAt: now + CLAIM_TTL_MS,
    };
    this.claims.set(id, self);

    const opposing = [...this.claims.values()].filter(
      (c) => c.deviceKey === self.deviceKey && c !== self && c.want !== self.want);
    if (opposing.length === 0) return { allowed: true };

    const best = [...opposing, self].sort(DeviceArbiterService.compare)[0];
    const decision: ClaimDecision = best === self
      ? { allowed: true }
      : { allowed: false, blockedBy: best };

    // 룰끼리 반대로 제어 → 사용자에게 알릴 충돌
    if (self.source === 'rule') {
      const rival = opposing.filter((c) => c.source === 'rule').sort(DeviceArbiterService.compare)[0];
      if (rival) decision.conflict = this.registerConflict(self, rival, now) ?? undefined;
    }
    return decision;
  }

  private registerConflict(a: Claim, b: Claim, now: number): ArbiterConflict | null {
    const [winner, loser] = [a, b].sort(DeviceArbiterService.compare);
    const id = `${a.deviceKey}|${[a.key, b.key].sort().join('|')}`;
    if ((this.dismissedUntil.get(id) ?? 0) > now) return null;
    if (this.conflicts.has(id)) return null; // 이미 알림 중
    const conflict: ArbiterConflict = {
      id,
      deviceKey: a.deviceKey,
      deviceName: winner.deviceName || loser.deviceName || '장치',
      userId: winner.userId,
      winner: { ruleId: winner.key, name: winner.label, want: winner.want, priority: winner.rulePriority },
      loser: { ruleId: loser.key, name: loser.label, want: loser.want, priority: loser.rulePriority },
      createdAt: new Date(now).toISOString(),
    };
    this.conflicts.set(id, conflict);
    this.logger.warn(
      `[conflict] ${conflict.deviceName}: "${winner.label}"(${wantLabel(winner.want)}, 우선순위 ${winner.rulePriority}) ↔ ` +
      `"${loser.label}"(${wantLabel(loser.want)}, 우선순위 ${loser.rulePriority})`);
    this.eventsGateway.broadcastAutomationConflict?.(conflict.userId, conflict);
    return conflict;
  }

  /** 요청 철회 */
  release(deviceKey: string, source: ArbiterSource, key: string) {
    this.claims.delete(DeviceArbiterService.claimId({ deviceKey, source, key }));
  }

  /** 한 주체(룰)의 요청을 모든 장치에서 철회 */
  releaseAll(source: ArbiterSource, key: string) {
    for (const [id, c] of this.claims) if (c.source === source && c.key === key) this.claims.delete(id);
    // 이 룰이 낀 충돌은 해소
    for (const [id, cf] of this.conflicts) {
      if (cf.winner.ruleId === key || cf.loser.ruleId === key) this.conflicts.delete(id);
    }
  }

  /** 장치의 현재 승자(없으면 null) */
  winnerFor(deviceKey: string): Claim | null {
    this.purge();
    const list = [...this.claims.values()].filter((c) => c.deviceKey === deviceKey);
    return list.sort(DeviceArbiterService.compare)[0] ?? null;
  }

  /** 화면·로그용 한 줄 설명 */
  explain(deviceKey: string): string {
    const w = this.winnerFor(deviceKey);
    if (!w) return '요청 없음';
    return `${SOURCE_LABEL[w.source]}${w.source === 'rule' ? ` "${w.label}"` : ''}이(가) ${wantLabel(w.want)} 요청 중`;
  }

  listConflicts(userId: string | null): ArbiterConflict[] {
    this.purge();
    return [...this.conflicts.values()].filter((c) => !userId || c.userId === userId);
  }

  getConflict(id: string): ArbiterConflict | undefined {
    return this.conflicts.get(id);
  }

  /** 사용자가 "그대로 두기"를 골랐다 — 하루 동안 같은 충돌은 다시 묻지 않는다. */
  dismissConflict(id: string) {
    this.conflicts.delete(id);
    this.dismissedUntil.set(id, Date.now() + DISMISS_MS);
  }

  /** 충돌이 해결됐다(룰을 비활성화함) */
  resolveConflict(id: string) {
    this.conflicts.delete(id);
  }

  /** 테스트용 초기화 */
  reset() {
    this.claims.clear();
    this.conflicts.clear();
    this.dismissedUntil.clear();
  }
}
