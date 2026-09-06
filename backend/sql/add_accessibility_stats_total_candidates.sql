-- accessibility_stats 테이블에 total_candidates 컬럼을 추가합니다.
--
-- 왜 필요한가:
--   무장애 통계는 "관광지 목록(후보) 중 편의시설이 있는 곳"을 세는 방식입니다.
--   관광공사 목록 API가 페이지 도중 끊기면 후보가 절반으로 줄고, 그러면 개수도
--   같이 반토막 납니다. 그런데 이때는 편의시설 '조회 실패' 카운터가 0이라
--   기존 퇴보 방지 로직(_is_regression)이 이걸 정상으로 보고 그대로 저장했습니다
--   (무장애 여행지 수가 1247건 → 491건으로 떨어진 원인).
--
--   이번 집계가 몇 곳을 놓고 센 것인지(total_candidates)를 함께 저장해두면,
--   다음 갱신 때 "후보 자체가 확 줄었으면 저장하지 않는다"를 판단할 수 있습니다.
--
-- 실행: Supabase 대시보드 → SQL Editor에 붙여넣고 Run.
--   이 컬럼이 없어도 앱은 정상 동작합니다(저장 시 자동으로 이 컬럼만 빼고 재시도).
--   다만 후보 급감 감지가 동작하지 않으니 실행을 권장합니다.

alter table public.accessibility_stats
  add column if not exists total_candidates integer;

comment on column public.accessibility_stats.total_candidates is
  '이 통계를 계산할 때 대상이 된 관광지 후보 수. 다음 갱신에서 후보가 급감했는지 판단하는 기준값.';
