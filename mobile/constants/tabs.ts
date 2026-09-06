/**
 * 하단 탭 5개의 순서를 한 곳에서 관리합니다.
 *
 * 이 순서는 세 곳이 함께 따라야 합니다.
 * 1) 하단 탭바에 그려지는 순서 (components/BottomTabBar.tsx)
 * 2) 좌우로 밀어서 넘길 때의 순서 (app/(tabs)/_layout.tsx의 화면 등록 순서)
 * 3) PC 웹의 좌우 화살표 버튼이 이동할 순서 (components/WebTabArrows.tsx)
 *
 * 예전에는 탭바와 네비게이터가 각자 순서를 갖고 있어서, 탭바 순서만 바꾸면
 * 밀어서 넘기는 순서와 어긋나게 됩니다. 그래서 목록을 하나로 합쳐뒀습니다.
 *
 * name은 app/(tabs) 안의 파일 이름(=경로 이름)이고, path는 이동할 때 쓰는 주소입니다.
 * 앱을 켰을 때 처음 열리는 화면은 순서와 무관하게 항상 '홈'(index)입니다
 * (_layout.tsx의 initialRouteName).
 */
export const TAB_ROUTES = [
  { name: "accessibility", path: "/accessibility", label: "접근성" },
  { name: "planner", path: "/planner", label: "AI 플래너" },
  { name: "index", path: "/", label: "홈" },
  { name: "posts", path: "/posts", label: "게시물" },
  { name: "trips", path: "/trips", label: "내 여행" },
] as const;

export type TabRoute = (typeof TAB_ROUTES)[number];
export type TabPath = TabRoute["path"];

/** 지금 보고 있는 주소가 탭 화면 중 몇 번째인지. 탭 화면이 아니면 -1. */
export function tabIndexOfPath(pathname: string): number {
  return TAB_ROUTES.findIndex((tab) =>
    tab.path === "/" ? pathname === "/" : pathname.startsWith(tab.path)
  );
}
