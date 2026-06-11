// 외국인 노동자가 월급/근무를 직접 이해할 수 있도록 하는 다국어 사전
// 지원 언어: 한국어(ko) · 필리핀어(tl) · 태국어(th) · 라오스어(lo)
// 금액·숫자는 그대로 두고 라벨/구조만 번역합니다.

export type PayrollLang = 'ko' | 'tl' | 'th' | 'lo'

export const LANG_OPTIONS: { code: PayrollLang; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'tl', label: 'Filipino' },
  { code: 'th', label: 'ไทย' },
  { code: 'lo', label: 'ລາວ' },
]

type LabelKey =
  | 'workDays'
  | 'totalHours'
  | 'overtime'
  | 'overtimeIncluded'
  | 'expectedTotal'
  | 'netPay'
  | 'holiday'
  | 'advance'
  | 'settleDay'
  | 'work'
  | 'deduction'
  | 'confirm'
  | 'confirmed'
  | 'settlementTitle'
  | 'cycleNote'
  | 'legendWork'
  | 'legendOvertime'
  | 'legendHoliday'
  | 'legendAdvance'
  | 'hoursUnit'
  | 'daysUnit'
  | 'perHour'
  | 'readonly'
  | 'expectedNet'
  | 'requestConfirm'
  | 'requested'
  | 'approve'
  | 'waitingApproval'

export const LABELS: Record<PayrollLang, Record<LabelKey, string>> = {
  ko: {
    workDays: '근무일',
    totalHours: '총 근무시간',
    overtime: '잔업',
    overtimeIncluded: '잔업 포함',
    expectedTotal: '예상 총액',
    netPay: '실수령액',
    holiday: '휴일',
    advance: '가불',
    settleDay: '정산일',
    work: '근무',
    deduction: '공제',
    confirm: '정산 확정',
    confirmed: '정산 완료',
    settlementTitle: '정산',
    cycleNote: '근무시작일 기준 매월 같은 날 마감',
    legendWork: '근무',
    legendOvertime: '잔업·조퇴',
    legendHoliday: '휴일',
    legendAdvance: '가불',
    hoursUnit: '시간',
    daysUnit: '일',
    perHour: '시급',
    readonly: '보기 전용',
    expectedNet: '이번 달 예상 실수령액',
    requestConfirm: '정산 확정 요청',
    requested: '확정 요청됨',
    approve: '정산 승인',
    waitingApproval: '관리자 승인 대기 중',
  },
  tl: {
    workDays: 'Araw ng trabaho',
    totalHours: 'Kabuuang oras',
    overtime: 'Overtime',
    overtimeIncluded: 'Kasama ang overtime',
    expectedTotal: 'Tinatayang kabuuan',
    netPay: 'Net na sahod',
    holiday: 'Pahinga',
    advance: 'Paunang bayad',
    settleDay: 'Araw ng sahod',
    work: 'Trabaho',
    deduction: 'Bawas',
    confirm: 'Kumpirmahin ang sahod',
    confirmed: 'Nakumpirma na',
    settlementTitle: 'Sahod',
    cycleNote: 'Tuwing buwan ayon sa petsa ng pagsisimula',
    legendWork: 'Trabaho',
    legendOvertime: 'OT / Maagang alis',
    legendHoliday: 'Pahinga',
    legendAdvance: 'Paunang bayad',
    hoursUnit: 'oras',
    daysUnit: 'araw',
    perHour: 'kada oras',
    readonly: 'Tingin lamang',
    expectedNet: 'Tinatayang net sahod ngayong buwan',
    requestConfirm: 'Hilingin ang kumpirmasyon',
    requested: 'Naipadala na',
    approve: 'Aprubahan',
    waitingApproval: 'Naghihintay ng pag-apruba',
  },
  th: {
    workDays: 'วันทำงาน',
    totalHours: 'ชั่วโมงรวม',
    overtime: 'ล่วงเวลา',
    overtimeIncluded: 'รวมล่วงเวลา',
    expectedTotal: 'ยอดรวมโดยประมาณ',
    netPay: 'เงินสุทธิ',
    holiday: 'วันหยุด',
    advance: 'เบิกล่วงหน้า',
    settleDay: 'วันจ่ายเงิน',
    work: 'ทำงาน',
    deduction: 'หักเงิน',
    confirm: 'ยืนยันการจ่ายเงิน',
    confirmed: 'ยืนยันแล้ว',
    settlementTitle: 'การจ่ายเงิน',
    cycleNote: 'สรุปทุกเดือนตามวันเริ่มงาน',
    legendWork: 'ทำงาน',
    legendOvertime: 'OT / กลับก่อน',
    legendHoliday: 'วันหยุด',
    legendAdvance: 'เบิกล่วงหน้า',
    hoursUnit: 'ชม.',
    daysUnit: 'วัน',
    perHour: 'ต่อชั่วโมง',
    readonly: 'ดูอย่างเดียว',
    expectedNet: 'เงินสุทธิโดยประมาณเดือนนี้',
    requestConfirm: 'ขอยืนยันการจ่ายเงิน',
    requested: 'ส่งคำขอแล้ว',
    approve: 'อนุมัติ',
    waitingApproval: 'รออนุมัติจากผู้ดูแล',
  },
  lo: {
    workDays: 'ມື້ເຮັດວຽກ',
    totalHours: 'ຊົ່ວໂມງລວມ',
    overtime: 'ໂອທີ',
    overtimeIncluded: 'ລວມໂອທີ',
    expectedTotal: 'ຍອດລວມໂດຍປະມານ',
    netPay: 'ເງິນສຸດທິ',
    holiday: 'ມື້ພັກ',
    advance: 'ເບີກລ່ວງໜ້າ',
    settleDay: 'ມື້ຈ່າຍເງິນ',
    work: 'ເຮັດວຽກ',
    deduction: 'ຫັກເງິນ',
    confirm: 'ຢືນຢັນການຈ່າຍເງິນ',
    confirmed: 'ຢືນຢັນແລ້ວ',
    settlementTitle: 'ການຈ່າຍເງິນ',
    cycleNote: 'ສະຫຼຸບທຸກເດືອນຕາມມື້ເລີ່ມວຽກ',
    legendWork: 'ເຮັດວຽກ',
    legendOvertime: 'ໂອທີ / ກັບກ່ອນ',
    legendHoliday: 'ມື້ພັກ',
    legendAdvance: 'ເບີກລ່ວງໜ້າ',
    hoursUnit: 'ຊມ.',
    daysUnit: 'ມື້',
    perHour: 'ຕໍ່ຊົ່ວໂມງ',
    readonly: 'ເບິ່ງຢ່າງດຽວ',
    expectedNet: 'ເງິນສຸດທິໂດຍປະມານເດືອນນີ້',
    requestConfirm: 'ຂໍຢືນຢັນການຈ່າຍເງິນ',
    requested: 'ສົ່ງຄຳຂໍແລ້ວ',
    approve: 'ອະນຸມັດ',
    waitingApproval: 'ລໍຖ້າການອະນຸມັດ',
  },
}

export function t(lang: PayrollLang, key: LabelKey): string {
  return LABELS[lang]?.[key] ?? LABELS.ko[key]
}

// ──── 공제/가불 항목명 번역 (사용자 입력 한국어 → 흔한 단어 매핑) ────
const DEDUCTION_DICT: { match: string[]; tl: string; th: string; lo: string }[] = [
  { match: ['숙소', '기숙사', '방세', '월세'], tl: 'Tirahan', th: 'ค่าที่พัก', lo: 'ຄ່າທີ່ພັກ' },
  { match: ['식대', '식비', '밥'], tl: 'Pagkain', th: 'ค่าอาหาร', lo: 'ຄ່າອາຫານ' },
  { match: ['전기'], tl: 'Kuryente', th: 'ค่าไฟ', lo: 'ຄ່າໄຟ' },
  { match: ['수도', '물세'], tl: 'Tubig', th: 'ค่าน้ำ', lo: 'ຄ່ານ້ຳ' },
  { match: ['가스'], tl: 'Gas', th: 'ค่าแก๊ส', lo: 'ຄ່າແກ໊ສ' },
  { match: ['병원', '약', '치료'], tl: 'Gamot / Ospital', th: 'ค่ารักษาพยาบาล', lo: 'ຄ່າປິ່ນປົວ' },
  { match: ['교통', '차비'], tl: 'Pamasahe', th: 'ค่าเดินทาง', lo: 'ຄ່າເດີນທາງ' },
  { match: ['보험'], tl: 'Insurance', th: 'ค่าประกัน', lo: 'ຄ່າປະກັນໄພ' },
  { match: ['가불', '선불'], tl: 'Paunang bayad', th: 'เบิกล่วงหน้า', lo: 'ເບີກລ່ວງໜ້າ' },
  { match: ['세금'], tl: 'Buwis', th: 'ภาษี', lo: 'ພາສີ' },
]

/** 공제/가불 라벨을 선택 언어로 번역. 매칭 실패 시 원문 유지(+병기). */
export function translateLabel(label: string, lang: PayrollLang): string {
  if (lang === 'ko' || !label) return label
  for (const entry of DEDUCTION_DICT) {
    if (entry.match.some((m) => label.includes(m))) {
      return entry[lang]
    }
  }
  return label // 사전에 없으면 원문 그대로
}

// ──── 금액 / 날짜 포맷 ────
export function formatMoney(n: number, lang: PayrollLang): string {
  const v = Math.round(n).toLocaleString('en-US')
  return lang === 'ko' ? `${v}원` : `₩${v}`
}

const MONTHS: Record<PayrollLang, string[]> = {
  ko: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
  tl: ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'],
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  lo: ['ມັງກອນ', 'ກຸມພາ', 'ມີນາ', 'ເມສາ', 'ພຶດສະພາ', 'ມິຖຸນາ', 'ກໍລະກົດ', 'ສິງຫາ', 'ກັນຍາ', 'ຕຸລາ', 'ພະຈິກ', 'ທັນວາ'],
}

/** 'YYYY-MM-DD' → 언어별 날짜 표기 */
export function formatLongDate(iso: string, lang: PayrollLang): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  const month = MONTHS[lang][m]
  if (lang === 'ko') return `${y}년 ${month} ${day}일`
  if (lang === 'th') return `${day} ${month} ${y}`
  if (lang === 'lo') return `${day} ${month} ${y}`
  return `${month} ${day}, ${y}` // tl
}

export function shortMD(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
}
