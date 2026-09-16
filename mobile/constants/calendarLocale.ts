/**
 * react-native-calendars의 달력 표기를 한국어로 맞춥니다.
 * 이 라이브러리는 기본값이 영어("January", "Sun")라서, 로케일을 등록하지 않으면
 * 앱의 나머지 화면과 언어가 어긋납니다.
 *
 * app/_layout.tsx에서 이 파일을 한 번만 import 하면 됩니다 — LocaleConfig는
 * 라이브러리 전역 설정이라, 앞으로 달력을 쓰는 화면이 늘어나도 자동 적용됩니다.
 */
import { LocaleConfig } from "react-native-calendars";

LocaleConfig.locales.ko = {
  monthNames: [
    "1월",
    "2월",
    "3월",
    "4월",
    "5월",
    "6월",
    "7월",
    "8월",
    "9월",
    "10월",
    "11월",
    "12월",
  ],
  monthNamesShort: [
    "1월",
    "2월",
    "3월",
    "4월",
    "5월",
    "6월",
    "7월",
    "8월",
    "9월",
    "10월",
    "11월",
    "12월",
  ],
  dayNames: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  dayNamesShort: ["일", "월", "화", "수", "목", "금", "토"],
  today: "오늘",
};

LocaleConfig.defaultLocale = "ko";
