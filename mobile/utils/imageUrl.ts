/**
 * 사진 주소의 http:// 를 https:// 로 올려줍니다.
 *
 * 앱(네이티브)은 평문 HTTP로 받아오는 사진을 아예 안 그립니다 — 안드로이드는
 * usesCleartextTraffic=false(app.json)와 targetSdk 28+ 기본 정책으로, iOS는 ATS
 * 기본 정책으로 막습니다. 오류도 없이 빈 칸으로 보여서 원인을 찾기 어렵습니다.
 * (웹 개발 서버는 http://localhost 라 혼합 콘텐츠 제한에 안 걸려서, 웹에서는
 * 멀쩡해 보였습니다.)
 *
 * 실제 원인인 TourAPI 사진 주소는 서버(schemas.py의 HttpsImageUrl)에서 이미
 * https로 바꿔서 내려줍니다. 여기 한 번 더 두는 이유는 서버를 거치지 않고
 * 그려지는 값이 있기 때문입니다 —
 *   - 홈 화면이 AsyncStorage에 저장해 둔 인기 여행지 캐시(app/(tabs)/index.tsx).
 *     이 캐시에는 고치기 전의 http:// 주소가 남아 있습니다.
 *   - 앞으로 추가될, 서버 모델을 거치지 않는 외부 사진 주소.
 *
 * data:/file:/content: 같은 다른 스킴(갤러리에서 고른 사진, 편집 결과)은
 * 그대로 둡니다 — http:// 로 시작할 때만 건드립니다.
 */
export function httpsImageUrl<T extends string | null | undefined>(url: T): T {
  if (typeof url === "string" && url.startsWith("http://")) {
    return ("https://" + url.slice("http://".length)) as T;
  }
  return url;
}
