-- AI 플래너 1단계에서 무엇을 추천했고, 2단계에서 사용자가 그중 무엇을 골랐는지 남깁니다.
--
-- 지금 품질 평가는 사람이 정한 기준(문장 조건 일치·등급·거리)으로만 합니다.
-- 이 기록이 쌓이면 "추천한 곳 중 실제로 고른 비율"을 잴 수 있고, 나중에는 자주
-- 고르는 곳·자주 건너뛰는 곳을 순위에 반영할 수 있습니다 (반영은 기록이 충분히
-- 쌓인 뒤에 따로 합니다).
--
-- 한 줄 = 추천 한 번. '다시 추천'을 누르면 줄이 하나 더 생깁니다. 코스를 만들면
-- 그 세션에서 나온 모든 줄에 selected_ids를 채웁니다 (그 줄의 추천 중 고른 것만).
--   selected_ids is null  → 코스를 만들지 않고 떠남
--   selected_ids = '{}'   → 코스는 만들었지만 이 추천에서는 하나도 안 고름
--
-- 로그인하지 않은 사용자도 기록합니다 (user_id null). 쓰기·읽기는 백엔드의
-- 서비스 키로만 합니다 — RLS를 켜고 정책을 두지 않아 앱에서 직접 접근할 수 없습니다.
create table if not exists public.planner_selection_logs (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid,                         -- 비로그인이면 null
  query_text text not null,
  user_type text not null,
  sigungu_cd int,
  visit_date date,
  recommended_ids text[] not null,      -- 화면에 보여준 순서 그대로
  selected_ids text[],
  selected_at timestamptz
);

create index if not exists planner_selection_logs_created_at_idx
  on public.planner_selection_logs (created_at);

alter table public.planner_selection_logs enable row level security;
