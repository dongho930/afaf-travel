-- 홈 화면 '인기 여행지' 지역 칩을 하드코딩된 5개 도시 대신, 실제 사용자 활동
-- (리뷰 수 + 게시물 수 + 저장된 코스 수 + 평점)을 기준으로 매일 다시 계산한
-- 상위 5개 도시로 보여주기 위한 캐시 테이블입니다.
--
-- backend/app/services/region_popularity_service.py의 refresh_region_popularity()가
-- 하루 한 번(수동 트리거 또는 외부 스케줄러) 전체를 다시 계산해서 이 테이블을
-- 통째로 교체합니다. 홈 화면은 이 테이블에서 rank 순으로 상위 N개만 가볍게 읽습니다.
create table if not exists public.region_popularity_daily (
  city_name text primary key,       -- 예: '수원' (표시용, '시/군' 접미사 제거된 형태)
  rank int not null,
  score double precision not null,  -- 4개 지표를 정규화해 가중합한 최종 점수 (0~1)
  review_count int not null default 0,
  post_count int not null default 0,
  save_count int not null default 0,
  avg_rating double precision,      -- 리뷰가 하나도 없으면 null
  computed_at timestamptz not null default now()
);

create index if not exists region_popularity_daily_rank_idx
  on public.region_popularity_daily (rank);
