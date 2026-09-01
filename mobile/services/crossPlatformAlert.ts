import { Alert as RNAlert, Platform } from "react-native";

type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

/**
 * React Native의 Alert.alert(취소/확인 버튼 있는 확인창)는 네이티브 전용 기능이라
 * 웹 브라우저에서는 그냥 아무 반응 없이 무시됩니다. 이 앱 여러 화면에서
 * "삭제할까요?", "방문 완료로 표시할까요?" 같은 확인창을 이 방식으로 쓰고
 * 있어서, 웹에서는 버튼을 눌러도 반응이 없는 문제가 있었습니다.
 *
 * 이 파일은 각 화면에서 `import { Alert } from "react-native"` 대신
 * `import { Alert } from "../services/crossPlatformAlert"` 로 바꿔치기해서
 * 쓰는 대체품입니다. 앱(iOS/Android)에서는 원래 Alert.alert 그대로 동작하고,
 * 웹에서만 브라우저의 confirm()/alert() 창으로 자동 대체됩니다. 호출하는
 * 쪽 코드(버튼 목록, onPress 콜백 등)는 전혀 안 바꿔도 됩니다.
 */
function webAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const fullText = message ? `${title}\n\n${message}` : title;
  const list = buttons && buttons.length > 0 ? buttons : [{ text: "확인" }];

  if (list.length === 1) {
    // 버튼이 하나뿐이면 정보 안내용 알림이라, 그냥 alert()로 보여주고 눌렀다고
    // 취급해서 onPress를 호출합니다.
    window.alert(fullText);
    list[0].onPress?.();
    return;
  }

  // 두 개 이상이면 "취소" 역할 버튼과 "확인/실행" 역할 버튼으로 나눠서
  // window.confirm()의 확인/취소로 매핑합니다. 이 프로젝트에서는 실제로
  // 항상 취소 1개 + 확인(또는 삭제 등 destructive) 1개 조합만 씁니다.
  const cancelButton = list.find((b) => b.style === "cancel");
  const confirmButton = list.find((b) => b !== cancelButton) ?? list[list.length - 1];

  const confirmed = window.confirm(fullText);
  if (confirmed) {
    confirmButton.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    if (Platform.OS === "web") {
      webAlert(title, message, buttons);
    } else {
      RNAlert.alert(title, message, buttons);
    }
  },
};
