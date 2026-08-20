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
  </script>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey={kakao_key}&autoload=false"
    onerror="showDebug('카카오맵 SDK 스크립트 로드 실패 (네트워크 문제)')"></script>
  <script>
    try {{
      if (typeof kakao === 'undefined') {{
        showDebug('kakao 객체가 정의되지 않음 — 도메인 미등록 또는 잘못된 키일 가능성이 높습니다. (key 앞 6자: {kakao_key_prefix})');
      }} else {{
        kakao.maps.load(function () {{
          try {{
            var map = new kakao.maps.Map(document.getElementById('map'), {{
              center: new kakao.maps.LatLng({center_lat}, {center_lng}),
              level: 8
            }});
            var markers = {markers_json};
            var routePath = {route_path_json};  // 실제 도로 좌표: [[lat, lng], ...] 또는 빈 배열

            markers.forEach(function (m) {{
              var pos = new kakao.maps.LatLng(m.lat, m.lng);
              var marker = new kakao.maps.Marker({{ position: pos, map: map }});
              var infowindow = new kakao.maps.InfoWindow({{ content: '<div style="padding:6px;font-size:12px;">' + m.name + '</div>' }});
              kakao.maps.event.addListener(marker, 'click', function () {{ infowindow.open(map, marker); }});
            }});

            var linePath;
            if (routePath.length > 1) {{
              // /route 에서 받아온 실제 도로 좌표로 그리기
              linePath = routePath.map(function (p) {{ return new kakao.maps.LatLng(p[0], p[1]); }});
            }} else {{
              // 폴백: 실제 경로 데이터가 없으면 마커를 직선으로 연결
              linePath = markers.map(function (m) {{ return new kakao.maps.LatLng(m.lat, m.lng); }});
            }}

            if (linePath.length > 1) {{
              new kakao.maps.Polyline({{
                path: linePath, map: map, strokeWeight: 4, strokeColor: '#2E7D5B',
                strokeOpacity: 0.8, strokeStyle: 'solid'
              }});
            }}

            showDebug('지도 로드 성공 (마커 ' + markers.length + '개, 경로점 ' + linePath.length + '개' +
              (routePath.length > 1 ? ', 실제 도로 경로 사용' : ', 직선 폴백') + ')');
            setTimeout(function () {{ document.getElementById('debug').style.display = 'none'; }}, 3000);
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
async def map_view(
    markers: str = Query(..., description="JSON 배열: [{lat, lng, name}]"),
    path: str = Query(
        default="",
        description="선택. /route API에서 받은 실제 도로 좌표 JSON: [[lat, lng], ...]. "
        "생략하면 마커를 직선으로 연결합니다.",
    ),
):
    """
    카카오맵 JS SDK는 등록된 도메인에서 로드된 페이지인지 확인합니다.
    모바일 앱의 WebView가 순수 HTML 문자열만 불러오면 '출처(origin)'가 없어서
    이 확인을 통과하지 못하므로, 이 백엔드(실제 도메인)에서 지도 페이지를 직접
    내려줘서 그 문제를 우회합니다. 이 서버의 도메인(예: afaf-travel.onrender.com)을
    카카오 개발자 콘솔의 'JavaScript SDK 도메인' 목록에 등록해야 지도가 뜹니다.

    path 파라미터로 /route 엔드포인트에서 받은 실제 도로 좌표를 그대로 넘기면
    직선 대신 실제 도로를 따라가는 경로선이 그려집니다.
    """
    try:
        marker_list = json.loads(markers)
    except (json.JSONDecodeError, TypeError):
        marker_list = []

    try:
        route_path_list = json.loads(path) if path else []
    except (json.JSONDecodeError, TypeError):
        route_path_list = []

    center = marker_list[0] if marker_list else {"lat": 37.2836, "lng": 127.017}
    kakao_key = settings.kakao_js_key

    html = _TEMPLATE.format(
        kakao_key=kakao_key,
        kakao_key_prefix=(kakao_key[:6] if kakao_key else "(없음)"),
        center_lat=center["lat"],
        center_lng=center["lng"],
        markers_json=json.dumps(marker_list, ensure_ascii=False),
        route_path_json=json.dumps(route_path_list, ensure_ascii=False),
    )
    return HTMLResponse(content=html)
