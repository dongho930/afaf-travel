/**
 * 앱 접근권한 고지 내용입니다.
 *
 * 국내 앱은 설치 후 처음 실행할 때 어떤 접근권한을 왜 쓰는지, 필수인지 선택인지를
 * 구분해 알려야 합니다(정보통신망법 제22조의2, 방송통신위원회 접근권한 안내 가이드).
 * 원스토어 상품 검증도 같은 기준으로 봅니다.
 *
 * 이 앱은 네 가지를 모두 '선택'으로 씁니다 — 허용하지 않아도 여행지 탐색, AI 코스
 * 만들기, 리뷰 읽기 같은 주요 기능이 그대로 동작합니다. 권한이 필요한 순간에만
 * 그 자리에서 요청하고(사전 일괄 요청 없음), 거부하면 그 기능만 건너뜁니다.
 *
 * 항목을 추가·변경할 때는 app.json의 permissions/infoPlist 설명과 이 목록이
 * 어긋나지 않게 함께 고쳐주세요 — 둘이 다르면 검증에서 지적받습니다.
 */
export type AppPermission = {
  /** 이용자에게 보이는 권한 이름 */
  name: string;
  /** 무엇에 쓰는지 — '왜 필요한지'가 드러나게 씁니다 */
  purpose: string;
};

/** 없어도 앱을 못 쓰는 권한. 지금은 없습니다. */
export const REQUIRED_PERMISSIONS: AppPermission[] = [];

export const OPTIONAL_PERMISSIONS: AppPermission[] = [
  {
    name: "마이크 · 음성 인식",
    purpose:
      "AI 플래너에서 원하는 여행을 말로 입력할 때 사용합니다. 말한 내용은 기기의 음성인식 기능(Android는 Google, iOS는 Apple)이 글자로 바꾸며, 음성은 앱 서버에 저장하지 않습니다. 직접 입력해도 됩니다.",
  },
  {
    name: "위치",
    purpose:
      "현재 위치에서 여행지까지 길찾기를 할 때 출발지로 사용합니다. 위치는 카카오맵 길안내로만 넘기며 앱 서버에는 보내지 않습니다.",
  },
  {
    name: "사진",
    purpose: "프로필 사진과 리뷰·게시물에 첨부할 사진을 고를 때 사용합니다. 고른 사진만 올라갑니다.",
  },
];

export const PERMISSION_NOTICE_TITLE = "앱 접근권한 안내";

export const PERMISSION_NOTICE_INTRO =
  "경기포올은 아래 기능을 이용하실 때에만 접근권한을 요청합니다. 모두 선택 권한이라 허용하지 않으셔도 여행지 탐색, AI 코스 만들기 등 대부분의 기능을 그대로 이용하실 수 있습니다.";

export const PERMISSION_NOTICE_WITHDRAW =
  "허용한 권한은 기기의 [설정 > 애플리케이션 > 경기포올 > 권한]에서 언제든지 다시 끄실 수 있습니다.";
