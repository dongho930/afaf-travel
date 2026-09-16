import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** 기기의 '동작 줄이기' 설정. 켜져 있으면 장식용 애니메이션을 생략합니다. */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mounted && setReduceMotion(enabled))
      .catch((err) => console.warn("[모션 설정] 불러오지 못했습니다:", err));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
