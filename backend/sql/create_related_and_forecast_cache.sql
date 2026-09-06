-- 연관 관광지 / 혼잡도 예보 캐시 테이블
-- Supabase 대시보드 SQL Editor에서 그대로 실행하세요.
--
-- 이 둘은 상세 페이지에서 쓰는데, 그동안 캐시가 없어서 페이지를 열 때마다
-- 공공데이터 API를 불렀습니다. 화면이 뜨는 속도가 공공데이터포털 상태에
-- 그대로 묶여 있었고, 포털이 죽은 날에는 이 영역이 통째로 비었습니다.
-- 이제 자정 갱신(GitHub Actions)이 미리 채우고 화면은 여기서만 읽습니다.
--
-- 연관 관광지(TarRlteTarService1)는 관광공사가 통계로 계산해 주는 데이터라
-- 우리가 재현할 수 없습니다. 그래서 응답을 그대로 담아둡니다. 캐시에 없는
-- 관광지는 '같은 시군구 + 같은 카테고리'로 대신 채웁니다(품질은 떨어지지만
-- DB만으로 답할 수 있습니다).
--
-- 백엔드가 서비스 키(관리자 권한)로만 접근하므로 별도 RLS 정책은 필요 없습니다.

create table public.attraction_related_cache (
  content_id text primary key,
  -- [{content_id, name, address, latitude, longitude, category, image_url}, ...]
  items jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create table public.attraction_forecast_cache (
  content_id text primary key,
  -- [{date: "YYYY-MM-DD", hour: 12, congestion_level: "low"|"medium"|"high"}, ...]
  forecast jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
