-- 여행기록(게시물) + 댓글/답글(1단계) 테이블
-- Supabase 대시보드 SQL Editor에서 그대로 실행하세요.
--
-- 실행 전 확인: place_reviews.user_id 컬럼 타입이 uuid가 아니라면
-- (Table Editor -> place_reviews -> user_id), 아래 posts/post_comments의
-- user_id 타입도 그 타입(예: text)으로 맞춰서 수정한 뒤 실행하세요.
--
-- 이 테이블들은 백엔드가 서비스 키(관리자 권한)로만 접근하고, 소유권 확인은
-- 애플리케이션 계층(app/services/post_service.py)에서 하므로 별도 RLS
-- 정책 추가는 필요 없습니다.
--
-- 이 SQL 실행 후, Storage에서 review-photos와 동일하게 공개(Public)로
-- 설정한 'post-photos' 버킷도 별도로 만들어주세요 (대시보드에서 New bucket).

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  content_id text not null,
  place_name text not null,
  body text not null,
  photo_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index posts_created_at_idx on public.posts (created_at desc);
create index posts_content_id_idx on public.posts (content_id);
create index posts_user_id_idx on public.posts (user_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  parent_comment_id uuid references public.post_comments(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index post_comments_post_id_idx on public.post_comments (post_id);
create index post_comments_parent_id_idx on public.post_comments (parent_comment_id);
