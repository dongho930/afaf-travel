-- 관광지 카테고리별 부가 정보(이용시간/요금/주차 등) 캐시 테이블
-- Supabase 대시보드 SQL Editor에서 그대로 실행하세요.
--
-- detailIntro2(소개정보 조회)는 detailCommon2/detailWithTour2와 같은 일일
-- 트래픽 한도를 공유하는 별도 오퍼레이션이라, 이것도 똑같이 캐시합니다.
-- 카테고리(contentTypeId)마다 응답 필드가 완전히 달라서, 화이트리스트로
-- 뽑아낸 필드만 fields(jsonb)에 {필드키: 값} 형태로 통째로 저장합니다.
--
-- 백엔드가 서비스 키(관리자 권한)로만 접근하므로 별도 RLS 정책은 필요 없습니다.

create table public.attraction_intro_cache (
  content_id text primary key,
  content_type_id integer,
  fields jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);
