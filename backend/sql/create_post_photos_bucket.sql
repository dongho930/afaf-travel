-- 게시물 사진용 Storage 버킷(post-photos) 생성.
-- Supabase 대시보드 SQL Editor에서 그대로 실행하세요.
--
-- 대시보드 Storage 화면에서 'New bucket'으로 만드는 것과 동일한 효과입니다
-- (버킷은 storage.buckets 테이블의 한 행일 뿐이라 SQL로 만들 수 있어요).
-- public = true로 설정해야 review-photos 버킷과 동일하게, 업로드된 사진의
-- 공개 URL을 로그인 없이도 바로 열람할 수 있습니다.
--
-- 이미 이 이름의 버킷이 있다면(예: 대시보드에서 먼저 만들어봤다면) 에러 없이
-- public 값만 true로 맞춰줍니다.

insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', true)
on conflict (id) do update set public = true;
