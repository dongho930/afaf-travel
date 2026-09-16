import json

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.config import get_settings

router = APIRouter(tags=["map"])
settings = get_settings()

# 마커 생김새 — 카테고리(TourAPI contentTypeId 라벨)마다 색과 아이콘을 다르게 해서
# 지도만 봐도 밥집인지 숙소인지 구분되게 합니다. 아이콘은 앱에서 쓰는 것과 같은
# Phosphor(bold) 글리프의 path 데이터라(viewBox 0 0 256 256) 앱과 지도의 인상이
# 어긋나지 않고, 인라인 SVG라서 이미지 요청이 한 건도 생기지 않습니다.
# 목록에 없는 카테고리(축제/여행코스 등)는 '기타'로 떨어집니다.
_MARKER_STYLES: dict[str, dict[str, str]] = {
    "관광지": {
        "color": "#2E7D5B",
        "icon": (
            "M160 80a32 32 0 1 0-32-32 32 32 0 0 0 32 32m0-40a8 8 0 1 1-8 8 8 8 0 0 1 8-8m94.32 153.88-54.56"
            "-92.08a19.85 19.85 0 0 0-17.21-9.8 19.83 19.83 0 0 0-17.2 9.8l-18.7 31.55-37.42-63.5a20 20 0 0 "
            "0-34.46 0L1.66 193.91A12 12 0 0 0 12 212h232a12 12 0 0 0 10.32-18.12M92 87.87 108.57 116H75.43Z"
            "M33 188l28.28-48h61.44L151 188Zm145.86 0-18.3-31 22-37.1 40.38 68.1Z"
        ),
    },
    "문화시설": {
        "color": "#6741D9",
        "icon": (
            "M24 108h20v48H32a12 12 0 0 0 0 24h192a12 12 0 0 0 0-24h-12v-48h20a12 12 0 0 0 6.29-22.22l-104-"
            "64a12 12 0 0 0-12.58 0l-104 64A12 12 0 0 0 24 108m44 0h24v48H68Zm72 0v48h-24v-48Zm48 48h-24v-4"
            "8h24ZM128 46.09 189.6 84H66.4ZM252 208a12 12 0 0 1-12 12H16a12 12 0 0 1 0-24h224a12 12 0 0 1 12 12"
        ),
    },
    "레포츠": {
        "color": "#E8590C",
        "icon": (
            "M152 92a36 36 0 1 0-36-36 36 36 0 0 0 36 36m0-48a12 12 0 1 1-12 12 12 12 0 0 1 12-12m76 93.4a12"
            " 12 0 0 1-7 10.91 66 66 0 0 1-21.47 3.78c-14 0-34.25-3.82-59.77-19a177 177 0 0 1-10.27 21C153.1"
            "2 162.83 188 183.8 188 232a12 12 0 0 1-24 0c0-18.69-6.95-33.06-21.26-43.94-9.16-7-19.55-11-27.4"
            "3-13.34-.81 1-1.64 2-2.5 2.95-20 22.87-44.82 34.76-72.25 34.76a97 97 0 0 1-9.75-.49 12 12 0 1 1"
            " 2.39-23.88c52.3 5.22 77.48-45.92 85.79-67.75-34.19-17.85-55.25-1.53-55.48-1.31a12 12 0 0 1-15-"
            "18.72C50.08 99 88 69.44 142.75 106.62c43.1 29.31 68.1 19.92 68.5 19.76a12 12 0 0 1 16.75 11Z"
        ),
    },
    "숙박": {
        "color": "#1C7ED6",
        "icon": (
            "M212 68H36V48a12 12 0 0 0-24 0v160a12 12 0 0 0 24 0v-28h196v28a12 12 0 0 0 24 0v-96a44.05 44.05"
            " 0 0 0-44-44m-112 88H36V92h64Zm132 0H124V92h88a20 20 0 0 1 20 20Z"
        ),
    },
    "음식점": {
        "color": "#E03131",
        "icon": (
            "M68 88V40a12 12 0 0 1 24 0v48a12 12 0 0 1-24 0m152-48v184a12 12 0 0 1-24 0v-44h-44a12 12 0 0 1-"
            "12-12 273.2 273.2 0 0 1 7.33-57.82c10.09-41.76 29.43-69.85 55.94-81.18A12 12 0 0 1 220 40m-24 2"
            "2.92C182.6 77 175 98 170.77 115.38a254.4 254.4 0 0 0-6.22 40.62H196ZM128 39a12 12 0 0 0-24 2l4 "
            "47.46a28 28 0 0 1-56 0L56 41a12 12 0 1 0-24-2l-4 48v1a52.1 52.1 0 0 0 40 50.59V224a12 12 0 0 0 "
            "24 0v-85.41A52.1 52.1 0 0 0 132 88v-1Z"
        ),
    },
    "쇼핑": {
        "color": "#C2255C",
        "icon": (
            "M216 36H40a20 20 0 0 0-20 20v144a20 20 0 0 0 20 20h176a20 20 0 0 0 20-20V56a20 20 0 0 0-20-20m-"
            "4 160H44V60h168ZM76 88a12 12 0 0 1 24 0 28 28 0 0 0 56 0 12 12 0 0 1 24 0 52 52 0 0 1-104 0"
        ),
    },
    "축제/공연/행사": {
        "color": "#F08C00",
        "icon": (
            "M114.32 49.8a19.79 19.79 0 0 0-32.6 7.2l-52.5 144.41A19.82 19.82 0 0 0 47.75 228a20 20 0 0 0 6."
            "84-1.22L199 174.28a19.79 19.79 0 0 0 7.24-32.6Zm-10.13 133.41-31.4-31.4 10.15-27.91 49.16 49.16"
            "Zm-40.42-6.51 15.53 15.56-24.45 8.89ZM157 164 92 99l10-27.58L184.57 154ZM128 40V16a12 12 0 0 1 "
            "24 0v24a12 12 0 0 1-24 0m116.48 83.51a12 12 0 0 1-17 17l-16-16a12 12 0 0 1 17-17Zm-.69-40.13-24"
            " 8a12 12 0 0 1-7.59-22.77l24-8a12 12 0 1 1 7.59 22.77M156.6 65.93C159.83 47.47 173.39 36 192 36"
            "c6.45 0 8.69-2.49 10-4.92a18 18 0 0 0 2-7.22V24a12 12 0 0 1 24 0c0 14.47-9.59 36-36 36-4.94 0-1"
            "0.21 1.19-11.76 10.06A12 12 0 0 1 168.43 80a12.4 12.4 0 0 1-2.08-.18 12 12 0 0 1-9.75-13.89"
        ),
    },
    "기타": {
        "color": "#495057",
        "icon": (
            "M128 60a44 44 0 1 0 44 44 44.05 44.05 0 0 0-44-44m0 64a20 20 0 1 1 20-20 20 20 0 0 1-20 20m0-11"
            "2a92.1 92.1 0 0 0-92 92c0 77.36 81.64 135.4 85.12 137.83a12 12 0 0 0 13.76 0 259 259 0 0 0 42.1"
            "8-39C205.15 170.57 220 136.37 220 104a92.1 92.1 0 0 0-92-92m31.3 174.71a249.4 249.4 0 0 1-31.3 "
            "30.18 249.4 249.4 0 0 1-31.3-30.18C80 167.37 60 137.31 60 104a68 68 0 0 1 136 0c0 33.31-20 63.3"
            "7-36.7 82.71"
        ),
    },
}

# 구간 이동수단별 선 모양. 도보는 점선으로 끊어 그려서, 차를 타는 구간과 걷는
# 구간이 지도에서 바로 구분됩니다.
_LEG_STYLES: dict[str, dict[str, object]] = {
    "walk": {"color": "#2F9E44", "style": "shortdash", "weight": 5},
    "transit": {"color": "#1C7ED6", "style": "solid", "weight": 5},
    "car": {"color": "#495057", "style": "solid", "weight": 5},
    # 추천 수단을 못 정한 구간(경로 조회 실패)은 흐린 회색 점선.
    "unknown": {"color": "#ADB5BD", "style": "dash", "weight": 4},
}

_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
    #debug { display: none; position: fixed; top: 0; left: 0; right: 0; background: #fff3cd; color: #664d03;
      font-family: monospace; font-size: 12px; padding: 8px; z-index: 999; white-space: pre-wrap; }

    /* 코스 마커: 흰 원 안에 카테고리 아이콘, 왼쪽 위에 방문 순서 배지, 아래에 꼬리. */
    .mk { position: relative; width: 36px; height: 43px; cursor: pointer; }
    .mk-body { position: absolute; top: 0; left: 0; width: 36px; height: 36px; box-sizing: border-box;
      border-radius: 50%; background: #fff; border: 2.5px solid #495057;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28); }
    .mk-body svg { width: 20px; height: 20px; display: block; }
    .mk-no { position: absolute; top: -7px; left: -8px; min-width: 20px; height: 20px; box-sizing: border-box;
      padding: 0 4px; border-radius: 999px; border: 2px solid #fff; background: #495057; color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif;
      font-size: 11px; font-weight: 700; line-height: 16px; text-align: center;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
    .mk-tip { position: absolute; top: 33px; left: 50%; margin-left: -5px; width: 0; height: 0;
      border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 10px solid #495057; }

    .iw { padding: 7px 10px; font-size: 12px; line-height: 1.45;
      font-family: -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif; color: #212529; }
    .iw b { display: block; font-size: 13px; }
    .iw span { color: #868E96; }
  </style>
</head>
<body>
  <div id="debug"></div>
  <div id="map"></div>
  <script>
    // 지도가 안 뜨는 이유를 알려줘야 할 때만 상단에 노란 띠로 보여줍니다.
    function showDebug(msg) {
      var el = document.getElementById('debug');
      el.textContent = msg;
      el.style.display = 'block';
    }
    window.onerror = function (message, source, lineno) {
      showDebug('JS 에러: ' + message + ' (line ' + lineno + ')');
    };
    if (!"__KAKAO_KEY__") {
      showDebug('KAKAO_JS_KEY가 서버에 설정되어 있지 않습니다 (빈 값)');
    }

    // React Native WebView와 웹(iframe) 양쪽에서 부모(앱)로 메시지를 보내기 위한 헬퍼
    function postToHost(payload) {
      var json = JSON.stringify(payload);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(json);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(json, '*');
      }
    }
  </script>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=__KAKAO_KEY__&autoload=false"
    onerror="showDebug('카카오맵 SDK 스크립트 로드 실패 (네트워크 문제)')"></script>
  <script>
    var map = null;
    var markers = __MARKERS_JSON__;
    var markerStyles = __MARKER_STYLES_JSON__;
    var legStyles = __LEG_STYLES_JSON__;
    var polylines = [];          // 구간마다 하나씩, 이동수단에 따라 색/점선이 다릅니다
    var openInfoWindow = null;
    var routeDrawn = false;      // 경로(직선이든 실제든)를 이미 한 번이라도 그렸는지
    var fallbackTimer = null;

    function styleForCategory(category) {
      return markerStyles[category] || markerStyles['기타'];
    }

    function escapeHtml(text) {
      return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // 마커 한 개의 DOM. 기본 Marker 대신 CustomOverlay를 쓰는 이유는, Marker는
    // 이미지를 바꿀 수는 있어도 그 위에 순서 번호를 얹을 수 없기 때문입니다.
    function buildMarkerElement(m) {
      var s = styleForCategory(m.category);
      var el = document.createElement('div');
      el.className = 'mk';
      el.innerHTML =
        '<div class="mk-body" style="border-color:' + s.color + '">' +
          '<svg viewBox="0 0 256 256" fill="' + s.color + '"><path d="' + s.icon + '"></path></svg>' +
        '</div>' +
        '<div class="mk-tip" style="border-top-color:' + s.color + '"></div>' +
        '<div class="mk-no" style="background:' + s.color + '">' + (m.order || '') + '</div>';
      return el;
    }

    function clearPolylines() {
      polylines.forEach(function (line) { line.setMap(null); });
      polylines = [];
    }

    // 마커 좌표를 직선으로 이은 기본 경로 (실제 도로 경로를 끝내 못 받았을 때의 최후 폴백)
    function straightPath() {
      return markers.map(function (m) { return [m.lat, m.lng]; });
    }

    function drawPolyline(points, mode) {
      if (!points || points.length < 2) return false;
      var s = legStyles[mode] || legStyles.unknown;
      polylines.push(new kakao.maps.Polyline({
        map: map,
        path: points.map(function (p) { return new kakao.maps.LatLng(p[0], p[1]); }),
        strokeWeight: s.weight, strokeColor: s.color, strokeOpacity: 0.85, strokeStyle: s.style
      }));
      return true;
    }

    /**
     * legs: [{ mode: 'walk'|'transit'|'car'|null, path: [[lat, lng], ...] }, ...]
     * 구간별로 따로 그려서 이동수단에 따라 선 색과 점선 여부가 달라집니다.
     * 그릴 게 하나도 없으면 마커를 직선으로 이은 최후 폴백을 그립니다.
     */
    function drawRoute(legs) {
      if (!map) return;
      clearPolylines();

      var drawn = 0;
      (legs || []).forEach(function (leg) {
        if (drawPolyline(leg && leg.path, leg && leg.mode)) drawn++;
      });

      var isReal = drawn > 0;
      if (!isReal) drawPolyline(straightPath(), 'unknown');

      routeDrawn = true;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }

      // 앱(부모)에게 "경로를 그렸다"고 알려줍니다. 앱은 이 신호를 받은 뒤에야
      // 로딩 오버레이를 걷어내고 지도를 보여줘서, 사용자가 직선이 잠깐이라도
      // 보이는 순간 없이 곧장 실제 경로만 보게 됩니다.
      postToHost({ type: 'route_drawn', isReal: isReal, legCount: drawn });
    }

    // 모바일 앱(WebView) 또는 웹(iframe)에서 지도 로드 완료 후 실제 경로 좌표를
    // postMessage로 전달합니다. URL 쿼리스트링에 큰 좌표 배열을 넣으면 URL이
    // 너무 길어져 ERR_CONNECTION_RESET 등의 문제가 생길 수 있어 이 방식을 씁니다.
    // 기대하는 메시지 형식: '{"legs": [{"mode": "walk", "path": [[lat, lng], ...]}, ...]}'
    // (예전 형식인 '{"path": [[lat, lng], ...]}'도 그대로 받습니다.)
    function handleMessage(event) {
      try {
        var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data) return;
        if (Array.isArray(data.legs)) {
          drawRoute(data.legs);
        } else if (Array.isArray(data.path)) {
          drawRoute([{ mode: null, path: data.path }]);
        }
      } catch (e) {
        // 우리 메시지 형식이 아닌 다른 postMessage는 무시
      }
    }
    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage); // Android RN WebView 호환

    try {
      if (typeof kakao === 'undefined') {
        showDebug('kakao 객체가 정의되지 않음 — 도메인 미등록 또는 잘못된 키일 가능성이 높습니다. (key 앞 6자: __KAKAO_KEY_PREFIX__)');
      } else {
        kakao.maps.load(function () {
          try {
            map = new kakao.maps.Map(document.getElementById('map'), {
              center: new kakao.maps.LatLng(__CENTER_LAT__, __CENTER_LNG__),
              level: 8
            });

            var bounds = new kakao.maps.LatLngBounds();

            markers.forEach(function (m) {
              var pos = new kakao.maps.LatLng(m.lat, m.lng);
              bounds.extend(pos);

              var el = buildMarkerElement(m);
              new kakao.maps.CustomOverlay({
                map: map, position: pos, content: el,
                xAnchor: 0.5, yAnchor: 1, clickable: true, zIndex: 3
              });

              var infowindow = new kakao.maps.InfoWindow({
                position: pos, zIndex: 5,
                content: '<div class="iw"><b>' + escapeHtml((m.order ? m.order + '. ' : '') + m.name) + '</b>' +
                  (m.category ? '<span>' + escapeHtml(m.category) + '</span>' : '') + '</div>'
              });

              // CustomOverlay에는 Marker 같은 kakao click 이벤트가 없어서 DOM
              // 이벤트로 직접 받습니다 (clickable: true라야 클릭이 전달됩니다).
              el.addEventListener('click', function () {
                if (openInfoWindow) openInfoWindow.close();
                infowindow.open(map);
                openInfoWindow = infowindow;
                postToHost({ type: 'marker_click', id: m.id });
              });
            });

            // 코스의 모든 지점이 한눈에 들어오도록 화면을 맞춥니다. 예전에는 첫
            // 지점을 중심으로 고정 배율(level 8)이라 멀리 떨어진 지점이 화면 밖에
            // 있었습니다. 지점이 하나뿐이면 너무 확대되므로 그대로 둡니다.
            if (markers.length > 1) map.setBounds(bounds, 60, 40, 40, 40);

            // 여기서 바로 직선을 그리지 않습니다. 실제 경로(postMessage)가 도착하면
            // drawRoute가 그때 처음으로 경로를 그립니다. 다만 /route 조회 자체가
            // 실패하는 경우를 대비해, 일정 시간(10초) 안에 메시지가 안 오면
            // 마지막 안전장치로 직선을 그립니다.
            fallbackTimer = setTimeout(function () {
              if (!routeDrawn) drawRoute(null);
            }, 10000);
          } catch (e) {
            showDebug('지도 생성 중 에러: ' + e.message);
          }
        });
      }
    } catch (e) {
      showDebug('kakao.maps.load 호출 전 에러: ' + e.message);
    }
  </script>
</body>
</html>"""


@router.get("/map-view", response_class=HTMLResponse)
async def map_view(markers: str = Query(..., description="JSON 배열: [{lat, lng, name, id, order, category}]")):
    """
    카카오맵 JS SDK는 등록된 도메인에서 로드된 페이지인지 확인합니다.
    모바일 앱의 WebView가 순수 HTML 문자열만 불러오면 '출처(origin)'가 없어서
    이 확인을 통과하지 못하므로, 이 백엔드(실제 도메인)에서 지도 페이지를 직접
    내려줘서 그 문제를 우회합니다. 이 서버의 도메인(예: afaf-travel.onrender.com)을
    카카오 개발자 콘솔의 'JavaScript SDK 도메인' 목록에 등록해야 지도가 뜹니다.

    markers의 각 항목은 {id, lat, lng, name, order, category}입니다. order는 코스
    방문 순서(마커 배지에 찍히는 번호), category는 '음식점'/'숙박'처럼 TourAPI
    카테고리 라벨이며 마커 색과 아이콘을 고릅니다(모르는 값이면 '기타').

    실제 도로 경로 좌표는 URL 파라미터로 받지 않습니다 (좌표가 많으면 URL이
    너무 길어져 연결이 끊길 수 있음). 대신 페이지 로드가 끝난 뒤 postMessage로
    '{"legs": [{"mode": "walk", "path": [[lat, lng], ...]}, ...]}' 형식의 메시지를
    보내주면 구간마다 이동수단에 맞는 색/점선으로 그립니다. 예전 형식인
    '{"path": [[lat, lng], ...]}'도 계속 받습니다(한 줄로 그림).

    페이지는 로드 직후 곧바로 직선을 그리지 않습니다 — 앱이 실제 경로를 보내줄
    때까지 기다렸다가 그립니다 (다만 10초 안에 아무 메시지도 안 오면 최후
    안전장치로 직선을 그립니다). 경로를 그릴 때마다
    '{"type": "route_drawn", "isReal": true|false, "legCount": N}' 메시지를
    앱에 보내니, 앱은 이 신호를 받은 뒤에 지도를 화면에 보여주면 됩니다.

    마커를 클릭하면 이 페이지가 앱(부모)에게
    '{"type": "marker_click", "id": <marker.id>}' 형식으로 postMessage를 보냅니다.
    각 마커 객체에 고유한 id를 넣어서 markers 파라미터를 구성해주세요.
    """
    try:
        marker_list = json.loads(markers)
    except (json.JSONDecodeError, TypeError):
        marker_list = []

    center = marker_list[0] if marker_list else {"lat": 37.2836, "lng": 127.017}
    kakao_key = settings.kakao_js_key

    # 이 페이지는 CSS/JS 중괄호가 많아서 str.format을 쓰면 중괄호를 전부 두 번씩
    # 써야 합니다. 값이 들어갈 자리만 이름표로 두고 바꿔치기해서, CSS/JS를 원본
    # 그대로 읽고 고칠 수 있게 했습니다.
    replacements = {
        "__KAKAO_KEY__": kakao_key,
        "__KAKAO_KEY_PREFIX__": kakao_key[:6] if kakao_key else "(없음)",
        "__CENTER_LAT__": str(center["lat"]),
        "__CENTER_LNG__": str(center["lng"]),
        "__MARKERS_JSON__": json.dumps(marker_list, ensure_ascii=False),
        "__MARKER_STYLES_JSON__": json.dumps(_MARKER_STYLES, ensure_ascii=False),
        "__LEG_STYLES_JSON__": json.dumps(_LEG_STYLES, ensure_ascii=False),
    }
    html = _TEMPLATE
    for token, value in replacements.items():
        html = html.replace(token, value)
    return HTMLResponse(content=html)
