import * as Location from "expo-location";
import { Linking, Platform } from "react-native";

/**
 * 카카오맵 길찾기 열기 — 관광지 상세 화면과 지도 화면이 같은 규칙으로 동작하도록
 * 한 곳에 모아둔 헬퍼입니다. 예전에는 두 화면이 제각각이었습니다(한쪽은 출발지를
 * 넣고 한쪽은 안 넣고, 수단 표기도 대소문자가 달랐습니다).
 *
 * 앱에서는 카카오맵을 바로 열어보고, 받아줄 앱이 없을 때만 모바일 웹으로 넘깁니다.
 * canOpenURL로 미리 확인하지 않는 이유는, 안드로이드 11부터 AndroidManifest에
 * <queries> 선언이 없으면 카카오맵이 깔려 있어도 무조건 false를 돌려주기 때문입니다.
 * 앱을 실행하는 것 자체는 그 제한을 받지 않아서, 열어보고 실패하면 그때 넘기는
 * 쪽이 실제 설치 여부와 맞습니다.
 */

// 카카오맵 스킴이 받는 이동수단 값(공식 문서 표기).
export type KakaoTravelMode = "CAR" | "PUBLICTRANSIT" | "FOOT" | "BICYCLE";

export interface KakaoPlace {
  name: string;
  latitude: number;
  longitude: number;
}

export type DirectionsFailure =
  | "location-permission" // 위치 권한을 주지 않음
  | "location-unavailable" // 현재 위치를 못 가져옴
  | "open-failed"; // 카카오맵도 웹도 열지 못함

export type DirectionsResult = { ok: true } | { ok: false; reason: DirectionsFailure };

const coord = (place: KakaoPlace) => `${place.latitude},${place.longitude}`;
const linkTarget = (place: KakaoPlace) =>
  `${encodeURIComponent(place.name)},${place.latitude},${place.longitude}`;

export async function openKakaoDirections({
  to,
  from,
  mode = "CAR",
}: {
  to: KakaoPlace;
  // 출발지. 주지 않으면 앱에서는 현재 위치를 묻고, 웹에서는 도착지만 채웁니다.
  from?: KakaoPlace | null;
  mode?: KakaoTravelMode;
}): Promise<DirectionsResult> {
  // 웹(PC 브라우저)에는 앱 스킴을 열 방법이 없고, 브라우저 위치는 GPS가 아니라
  // Wi-Fi/IP 기반 추정이라 실제 위치와 꽤 차이납니다. 그래서 내 위치를 자동으로
  // 출발지로 잡지 않고, 아는 만큼만 채운 카카오맵 페이지를 엽니다.
  if (Platform.OS === "web") {
    const url = from
      ? `https://map.kakao.com/?sName=${encodeURIComponent(from.name)}&eName=${encodeURIComponent(to.name)}`
      : `https://map.kakao.com/link/to/${linkTarget(to)}`;
    try {
      await Linking.openURL(url);
      return { ok: true };
    } catch {
      return { ok: false, reason: "open-failed" };
    }
  }

  let start = from ? coord(from) : null;
  if (!start) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return { ok: false, reason: "location-permission" };
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      start = `${position.coords.latitude},${position.coords.longitude}`;
    } catch {
      return { ok: false, reason: "location-unavailable" };
    }
  }

  const query = `sp=${start}&ep=${coord(to)}&by=${mode}`;
  try {
    await Linking.openURL(`kakaomap://route?${query}`);
    return { ok: true };
  } catch {
    // 카카오맵이 없으면 모바일 웹으로 — 설치 유도 페이지로도 이어집니다.
    try {
      await Linking.openURL(`https://m.map.kakao.com/scheme/route?${query}`);
      return { ok: true };
    } catch {
      return { ok: false, reason: "open-failed" };
    }
  }
}

/** 길찾기에 실패했을 때 사용자에게 보여줄 안내 문구. */
export function directionsFailureMessage(reason: DirectionsFailure): { title: string; body: string } {
  if (reason === "location-permission") {
    return {
      title: "위치 권한이 필요해요",
      body: "내 위치에서 길을 찾으려면 위치 권한을 허용해주세요.",
    };
  }
  if (reason === "location-unavailable") {
    return {
      title: "길찾기 실패",
      body: "현재 위치를 가져오지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }
  return {
    title: "길찾기 실패",
    body: "카카오맵을 열지 못했어요. 잠시 후 다시 시도해주세요.",
  };
}
