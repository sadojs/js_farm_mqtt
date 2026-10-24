-- 054: 농작업 기본 작업 종류 '최초 1회만' 생성 표시
-- 이전: 작업 화면을 열 때마다 기본 6종 중 없는 것을 다시 만들어, 기본 작업은 삭제해도 되살아났다(그래서 숨김만 가능).
-- 이후: 농장마다 한 번 만들고 표시를 남긴다 → 기본 작업도 삭제 가능.
-- 이미 작업 종류가 있는 농장은 생성된 것으로 표시. idempotent.
ALTER TABLE users ADD COLUMN IF NOT EXISTS work_types_seeded_at timestamptz;

UPDATE users u
   SET work_types_seeded_at = now()
 WHERE u.work_types_seeded_at IS NULL
   AND EXISTS (SELECT 1 FROM work_task_types t WHERE t.user_id::text = u.id::text);
