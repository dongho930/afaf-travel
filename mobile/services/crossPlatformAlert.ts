/**
 * 앱의 안내 창입니다. 화면 코드는 예전과 똑같이
 * `import { Alert } from "../services/crossPlatformAlert"` 한 뒤
 * `Alert.alert(제목, 내용, 버튼들)`로 부릅니다 — 부르는 쪽 코드는 하나도
 * 바뀌지 않았고, 속만 바뀌었습니다(호출하는 곳이 113군데입니다).
 *
 * 예전에는 운영체제에 창 그리기를 맡겼습니다(네이티브는 RN의 Alert.alert,
 * 웹은 브라우저의 alert()/confirm()). 그래서 앱 안에서 유일하게 브랜드 초록도,
 * Pretendard도, 어두운 테마도 적용되지 않는 화면이었고, 웹에서는 브라우저
 * 기본 창이 떠서 더 이질적인 데다 버튼을 두 개까지밖에 못 썼습니다.
 *
 * 이제는 앱이 직접 그립니다. 이 파일은 "무엇을 띄울지"만 줄 세워두고,
 * 실제로 그리는 일은 components/AppAlert.tsx의 AppAlertHost가 맡습니다
 * (app/_layout.tsx에 한 번만 붙여둡니다). 화면 컴포넌트 밖(서비스 코드)에서도
 * 부를 수 있어야 해서 이렇게 나눴습니다.
 */

export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

/** 안내 창의 성격 — 배지 색을 고르는 데 씁니다. */
export type AlertTone = "primary" | "danger" | "warning";

/** 배지 안에 들어갈 아이콘. components/AppAlert.tsx가 실제 아이콘으로 바꿉니다. */
export type AlertIconName = "check" | "info" | "question" | "lock" | "trash" | "alert";

export type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  tone: AlertTone;
  icon: AlertIconName;
};

// 안내 창의 성격은 부르는 쪽에서 따로 알려주지 않습니다. 113군데를 전부 고쳐
// 성격을 붙이는 대신, 제목·내용과 버튼 구성에서 읽어냅니다. 규칙이 빗나가도
// 아이콘만 덜 어울릴 뿐 안내 자체는 그대로 뜹니다.
const ERROR_PATTERN = /실패|오류|에러|못했|못 불러|불러오지 못|없어요|없습니다|없음|초과|거부|잘못/;
const SUCCESS_PATTERN = /완료|등록됐|감사|저장됐/;
const LOCK_PATTERN = /로그인|권한/;

function classify(
  title: string,
  message: string | undefined,
  buttons: AlertButton[]
): { tone: AlertTone; icon: AlertIconName } {
  // '삭제' 같은 되돌릴 수 없는 동작은 버튼 스타일로 이미 표시돼 있습니다.
  if (buttons.some((b) => b.style === "destructive")) return { tone: "danger", icon: "trash" };

  const text = `${title} ${message ?? ""}`;
  if (ERROR_PATTERN.test(text)) return { tone: "warning", icon: "alert" };
  // '로그인이 필요해요', '권한이 필요해요' — 무엇을 해야 하는지가 분명한 안내입니다.
  if (LOCK_PATTERN.test(title)) return { tone: "primary", icon: "lock" };
  if (SUCCESS_PATTERN.test(text)) return { tone: "primary", icon: "check" };
  // 고를 게 있으면 묻는 창, 하나뿐이면 알려주는 창입니다.
  if (buttons.length > 1) return { tone: "primary", icon: "question" };
  return { tone: "primary", icon: "info" };
}

let nextId = 1;
const queue: AlertRequest[] = [];
// 창을 그리는 쪽(AppAlertHost)은 앱 전체에 하나뿐이라 구독자도 하나만 둡니다.
let listener: ((items: AlertRequest[]) => void) | null = null;

function emit() {
  listener?.([...queue]);
}

/**
 * 안내 창을 그리는 컴포넌트가 붙을 때 부릅니다. 붙기 전에 이미 쌓인 안내가
 * 있으면(앱을 켜자마자 뜨는 오류 등) 그것도 바로 넘겨줍니다.
 */
export function subscribeToAlerts(fn: (items: AlertRequest[]) => void): () => void {
  listener = fn;
  fn([...queue]);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** 창을 닫습니다. 버튼을 눌렀을 때와 뒤로 가기로 닫을 때 모두 여기로 옵니다. */
export function dismissAlert(id: number) {
  const index = queue.findIndex((a) => a.id === id);
  if (index >= 0) queue.splice(index, 1);
  emit();
}

export const Alert = {
  /**
   * 버튼을 안 주면 '확인' 하나짜리 알림으로 띄웁니다(RN Alert와 같은 규칙).
   * 여러 개가 겹쳐 뜰 일이 있으면 줄을 세워 하나씩 보여줍니다.
   */
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    const list = buttons && buttons.length > 0 ? buttons : [{ text: "확인" }];
    queue.push({
      id: nextId++,
      title,
      message,
      buttons: list,
      ...classify(title, message, list),
    });
    emit();
  },
};
