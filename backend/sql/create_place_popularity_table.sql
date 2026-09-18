-- 홈 화면 '인기 여행지' 목록의 순서를 정하는 캐시 테이블입니다.
--
-- 지금까지 이 목록은 관광공사 areaBasedList2가 돌려주는 순서를 그대로 썼는데,
-- 그 API는 arrange를 주지 않으면 제목순(가나다)으로 돌려줍니다. 그래서 '인기
-- 여행지'인데 실제로는 '이름이 ㄱ으로 시작하는 곳'이 매번 같게 나왔습니다.
--
-- region_popularity_daily(도시 단위 인기도)와 같은 지표·같은 가중치를 쓰되,
-- 도시로 묶지 않고 관광지 한 곳(content_id) 단위로 점수를 냅니다. 계산은
-- backend/app/services/place_popularity_service.py의 refresh_place_popularity()가
-- 하루 한 번(수동 트리거 또는 외부 스케줄러) 맡고, 홈 화면 목록 조회는 이
-- 테이블을 통째로 한 번 읽어 정렬에만 씁니다.
--
-- 활동이 있는 곳만 담깁니다 — 경기도 관광지 전체를 0점으로 채우면 테이블만
-- 커지고 얻는 게 없습니다. 여기 없는 곳은 점수 0으로 보고 뒤쪽에 섞입니다.
create table if not exists public.place_popularity_daily (
  content_id text primary key,      -- 관광공사 콘텐츠 ID
  rank int not null,
  score double precision not null,  -- 4개 지표를 정규화해 가중합한 최종 점수 (0~1)
  review_count int not null default 0,
  post_count int not null default 0,
  save_count int not null default 0,
  avg_rating double precision,      -- 리뷰가 하나도 없으면 null
  computed_at timestamptz not null default now()
);

create index if not exists place_popularity_daily_rank_idx
  on public.place_popularity_daily (rank);
