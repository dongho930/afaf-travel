import json

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.config import get_settings

router = APIRouter(tags=["map"])
settings = get_settings()

_TEMPLATE = """<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    html, body, #map {{ width: 100%; height: 100%; margin: 0; padding: 0; }}
    #debug {{ position: fixed; top: 0; left: 0; right: 0; background: #fff3cd; color: #664d03;
      font-family: monospace; font-size: 12px; padding: 8px; z-index: 999; white-space: pre-wrap; }}
  </style>
</head>
<body>
  <div id="debug"></div>
  <div id="map"></div>
  <script>
    function showDebug(msg) {{ document.getElementById('debug').textContent = msg; }}
    window.onerror = function (message, source, lineno) {{
      showDebug('JS 에러: ' + message + ' (line ' + lineno + ')');
    }};
    if (!"{kakao_key}") {{
      showDebug('KAKAO_JS_KEY가 서버에 설정되어 있지 않습니다 (빈 값)');
    }}

    // React Native WebView와 웹(iframe) 양쪽에서 부모(앱)로 메시지를 보내기 위한 헬퍼
    function postToHost(payload) {{
      var json = JSON.stringify(payload);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {{
        window.ReactNativeWebView.postMessage(json);
      }}
      if (window.parent && window.parent !== window) {{
        window.parent.postMessage(json, '*');
      }}
    }}
  </script>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey={kakao_key}&autoload=false"
    onerror="showDebug('카카오맵 SDK 스크립트 로드 실패 (네트워크 문제)')"></script>
  <script>
    var map = null;
    var markers = {markers_json};
    var currentPolyline = null;
    var routeDrawn = false;         // 경로(직선이든 실제든)를 이미 한 번이라도 그렸는지
    var fallbackTimer = null;

    // 마커 좌표를 직선으로 이은 기본 경로 (실제 도로 경로를 끝내 못 받았을 때의 최후 폴백)
    function straightPath() {{
      return markers.map(function (m) {{ return [m.lat, m.lng]; }});
    }}

    function drawRoute(pathPoints) {{
      if (!map) return;
      if (currentPolyline) {{
        currentPolyline.setMap(null);
        currentPolyline = null;
      }}
      var isReal = !!(pathPoints && pathPoints.length > 1);
      var usePoints = isReal ? pathPoints : straightPath();
      if (usePoints.length < 2) return;

      var linePath = usePoints.map(function (p) {{ return new kakao.maps.LatLng(p[0], p[1]); }});
      currentPolyline = new kakao.maps.Polyline({{
        path: linePath, map: map, strokeWeight: 4, strokeColor: '#2E7D5B',
        strokeOpacity: 0.8, strokeStyle: 'solid'
      }});

      routeDrawn = true;
      if (fallbackTimer) {{ clearTimeout(fallbackTimer); fallbackTimer = null; }}

      showDebug('경로 갱신 (' + usePoints.length + '개 점' + (isReal ? ', 실제 도로 경로' : ', 직선 폴백') + ')');
      setTimeout(function () {{ document.getElementById('debug').style.display = 'none'; }}, 3000);

      // 앱(부모)에게 "경로를 그렸다"고 알려줍니다. 앱은 이 신호를 받은 뒤에야
      // 로딩 오버레이를 걷어내고 지도를 보여줘서, 사용자가 직선이 잠깐이라도
      // 보이는 순간 없이 곧장 실제 경로만 보게 됩니다.
      postToHost({{ type: 'route_drawn', isReal: isReal, pointCount: usePoints.length }});
    }}

    // 모바일 앱(WebView) 또는 웹(iframe)에서 지도 로드 완료 후 실제 경로 좌표를
    // postMessage로 전달합니다. URL 쿼리스트링에 큰 좌표 배열을 넣으면 URL이
    // 너무 길어져 ERR_CONNECTION_RESET 등의 문제가 생길 수 있어 이 방식을 씁니다.
    // 기대하는 메시지 형식: JSON 문자열 '{{"path": [[lat, lng], ...]}}'
    function handleMessage(event) {{
      try {{
        var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && Array.isArray(data.path)) {{
          drawRoute(data.path);
        }}
      }} catch (e) {{
        // 우리 메시지 형식이 아닌 다른 postMessage는 무시
      }}
    }}
    window.addEventListener('message', handleMessage);
    document.addEventListener('message', handleMessage); // Android RN WebView 호환

    try {{
      if (typeof kakao === 'undefined') {{
        showDebug('kakao 객체가 정의되지 않음 — 도메인 미등록 또는 잘못된 키일 가능성이 높습니다. (key 앞 6자: {kakao_key_prefix})');
      }} else {{
        kakao.maps.load(function () {{
          try {{
            map = new kakao.maps.Map(document.getElementById('map'), {{
              center: new kakao.maps.LatLng({center_lat}, {center_lng}),
              level: 8
            }});

            markers.forEach(function (m) {{
              var pos = new kakao.maps.LatLng(m.lat, m.lng);
              var marker = new kakao.maps.Marker({{ position: pos, map: map }});
              var infowindow = new kakao.maps.InfoWindow({{ content: '<div style="padding:6px;font-size:12px;">' + m.name + '</div>' }});
              kakao.maps.event.addListener(marker, 'click', function () {{
                infowindow.open(map, marker);
                postToHost({{ type: 'marker_click', id: m.id }});
              }});
            }});

            // 여기서 바로 직선을 그리지 않습니다. 실제 경로(postMessage)가 도착하면
            // drawRoute가 그때 처음으로 경로를 그립니다. 다만 /route 조회 자체가
            // 실패하는 경우를 대비해, 일정 시간(10초) 안에 메시지가 안 오면
            // 마지막 안전장치로 직선을 그립니다.
            fallbackTimer = setTimeout(function () {{
              if (!routeDrawn) drawRoute(null);
            }}, 10000);
          }} catch (e) {{
            showDebug('지도 생성 중 에러: ' + e.message);
          }}
        }});
      }}
    }} catch (e) {{
      showDebug('kakao.maps.load 호출 전 에러: ' + e.message);
    }}
  </script>
</body>
</html>"""


@router.get("/map-view", response_class=HTMLResponse)
async def map_view(markers: str = Query(..., description="JSON 배열: [{lat, lng, name, id}]")):
    """
    카카오맵 JS SDK는 등록된 도메인에서 로드된 페이지인지 확인합니다.
    모바일 앱의 WebView가 순수 HTML 문자열만 불러오면 '출처(origin)'가 없어서
    이 확인을 통과하지 못하므로, 이 백엔드(실제 도메인)에서 지도 페이지를 직접
    내려줘서 그 문제를 우회합니다. 이 서버의 도메인(예: afaf-travel.onrender.com)을
    카카오 개발자 콘솔의 'JavaScript SDK 도메인' 목록에 등록해야 지도가 뜹니다.

    실제 도로 경로 좌표는 URL 파라미터로 받지 않습니다 (좌표가 많으면 URL이
    너무 길어져 연결이 끊길 수 있음). 대신 페이지 로드가 끝난 뒤 postMessage로
    '{"path": [[lat, lng], ...]}' 형식의 메시지를 보내주면 그걸로 경로를 그립니다.

    페이지는 로드 직후 곧바로 직선을 그리지 않습니다 — 앱이 실제 경로를 보내줄
    때까지 기다렸다가 그립니다 (다만 10초 안에 아무 메시지도 안 오면 최후
    안전장치로 직선을 그립니다). 경로를 그릴 때마다
    '{"type": "route_drawn", "isReal": true|false, "pointCount": N}' 메시지를
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

    html = _TEMPLATE.format(
        kakao_key=kakao_key,
        kakao_key_prefix=(kakao_key[:6] if kakao_key else "(없음)"),
        center_lat=center["lat"],
        center_lng=center["lng"],
        markers_json=json.dumps(marker_list, ensure_ascii=False),
    )
    return HTMLResponse(content=html)
