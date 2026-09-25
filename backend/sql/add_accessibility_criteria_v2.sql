-- 접근성 분류 기준 v2 (backend/app/services/accessibility_criteria.py)에 필요한 컬럼을 추가합니다.
--
-- 왜 필요한가:
--   경기도 무장애 여행지 1,250곳 표본을 분석해서 유형별 분류 기준을 바꿨습니다.
--   - 휠체어 탭: 접근로(또는 출입통로)와 장애인 화장실이 모두 확인된 곳만
--   - 임산부 탭: 수유실·임산부 주차구역·기저귀 교환대 중 하나가 있는 곳 (휠체어 탭과 분리)
--   - 고령자 탭: 수유실 기준 → 접근로·엘리베이터·화장실 기준
--   새 기준에 쓰는 항목(장애인 객실, 저상버스, 기저귀 교환대 등)을 캐시에 저장할 컬럼과,
--   예전 규칙으로 저장된 행을 골라 다시 조회하기 위한 parse_version이 필요합니다.
--
-- 실행: Supabase 대시보드 → SQL Editor에 붙여넣고 Run.
--   백엔드를 배포하기 "전에" 실행해야 합니다. 컬럼이 없으면 편의시설 캐시 저장이
--   통째로 실패하고, 접근성 통계 조회(criteria_version 컬럼)도 실패합니다.

alter table public.place_accessibility_cache
  add column if not exists has_parking boolean,
  add column if not exists has_exit boolean,
  add column if not exists has_visual_accessibility boolean,
  add column if not exists has_hearing_accessibility boolean,
  add column if not exists has_accessible_room boolean,
  add column if not exists has_accessible_seating boolean,
  add column if not exists has_low_floor_bus boolean,
  add column if not exists has_seated_table boolean,
  add column if not exists has_diaper_station boolean,
  add column if not exists has_pregnant_parking boolean,
  add column if not exists has_emergency_bell boolean,
  add column if not exists has_hearing_etc boolean,
  add column if not exists parse_version integer;

comment on column public.place_accessibility_cache.parse_version is
  '이 행을 만든 해석 규칙 버전(accessibility_criteria.PARSE_VERSION). 낮으면 다음 갱신 때 다시 조회합니다. NULL은 v1.';
comment on column public.place_accessibility_cache.has_rest_area is
  'v2부터: 벤치·쉼터·휴게시설. v1(parse_version NULL)에서는 수유실/유아용 의자 여부였습니다.';

alter table public.accessibility_stats
  add column if not exists criteria_version integer;

comment on column public.accessibility_stats.criteria_version is
  '이 통계를 계산한 분류 기준 버전(accessibility_criteria.CRITERIA_VERSION). 기준이 바뀐 직후 첫 집계의 숫자 감소는 퇴보로 보지 않습니다.';
