import Constants from "expo-constants";
import React, { useMemo } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useCourseContext } from "../services/CourseContext";

/**
 * 카카오맵은 공식 React Native SDK가 없으므로,
 * 카카오맵 JavaScript SDK를 WebView에 임베드하는 방식으로 연동합니다.
 * (네이티브 성능이 꼭 필요하다면 iOS/Android 각각 카카오맵 네이티브 SDK를
 *  Expo Config Plugin으로 브리지하는 방향으로 교체 가능합니다.)
 */
export default function MapScreen() {
  const { course } = useCourseContext();
  const kakaoJsKey = (Constants.expoConfig?.extra?.kakaoJsKey as string) ?? "";

  const html = useMemo(() => {
    if (!course) return "";
    const markers = course.stops.map((s) => ({
      lat: s.attraction.latitude,
      lng: s.attraction.longitude,
      name: `${s.order}. ${s.attraction.name}`,
    }));
    const center = markers[0] ?? { lat: 37.2836, lng: 127.017 };

    return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoJsKey}&autoload=false"></script>
  <script>
    kakao.maps.load(function () {
      var map = new kakao.maps.Map(document.getElementById('map'), {
        center: new kakao.maps.LatLng(${center.lat}, ${center.lng}),
        level: 8
      });
      var linePath = [];
      var markers = ${JSON.stringify(markers)};
      markers.forEach(function (m) {
        var pos = new kakao.maps.LatLng(m.lat, m.lng);
        linePath.push(pos);
        var marker = new kakao.maps.Marker({ position: pos, map: map });
        var infowindow = new kakao.maps.InfoWindow({ content: '<div style="padding:6px;font-size:12px;">' + m.name + '</div>' });
        kakao.maps.event.addListener(marker, 'click', function () { infowindow.open(map, marker); });
      });
      if (linePath.length > 1) {
        new kakao.maps.Polyline({
          path: linePath, map: map, strokeWeight: 4, strokeColor: '#2E7D5B',
          strokeOpacity: 0.8, strokeStyle: 'solid'
        });
      }
    });
  </script>
</body>
</html>`;
  }, [course, kakaoJsKey]);

  if (!course) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>먼저 여행 코스를 생성해주세요.</Text>
      </View>
    );
  }

  if (!kakaoJsKey || kakaoJsKey.startsWith("여기에")) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>
          카카오맵 JavaScript 키가 설정되지 않았습니다.{"\n"}
          app.json 의 extra.kakaoJsKey 값을 발급받은 키로 채워주세요.
        </Text>
        <Text style={styles.link} onPress={() => Linking.openURL("https://developers.kakao.com")}>
          developers.kakao.com에서 키 발급받기 →
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {Platform.OS === "web" ? (
        // react-native-webview는 웹을 지원하지 않으므로, 웹에서는 iframe으로 동일한 HTML을 띄웁니다.
        <iframe
          srcDoc={html}
          style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
        />
      ) : (
        <WebView
          originWhitelist={["*"]}
          source={{ html }}
          style={{ flex: 1 }}
          javaScriptEnabled
          domStorageEnabled
        />
      )}
      <View style={styles.footer}>
        <Pressable
          style={styles.navButton}
          onPress={() => {
            const first = course.stops[0]?.attraction;
            if (!first) return;
            const url =
              Platform.OS === "ios"
                ? `kakaomap://route?ep=${first.latitude},${first.longitude}&by=FOOT`
                : `kakaomap://route?ep=${first.latitude},${first.longitude}&by=FOOT`;
            Linking.canOpenURL(url).then((supported) => {
              if (supported) Linking.openURL(url);
              else
                Linking.openURL(
                  `https://map.kakao.com/link/to/${encodeURIComponent(first.name)},${first.latitude},${first.longitude}`
                );
            });
          }}
        >
          <Text style={styles.navButtonText}>🚶 카카오맵 앱으로 길찾기</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { fontSize: 14, color: "#5C5C5C", textAlign: "center", lineHeight: 20 },
  link: { color: "#2E7D5B", fontWeight: "700", marginTop: 12 },
  footer: { position: "absolute", bottom: 16, left: 16, right: 16 },
  navButton: {
    backgroundColor: "#2E7D5B",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  navButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});
