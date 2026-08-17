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
  <style>html, body, #map {{ width: 100%; height: 100%; margin: 0; padding: 0; }}</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey={kakao_key}&autoload=false"></script>
  <script>
    kakao.maps.load(function () {{
      var map = new kakao.maps.Map(document.getElementById('map'), {{
        center: new kakao.maps.LatLng({center_lat}, {center_lng}),
        level: 8
      }});
      var linePath = [];
      var markers = {markers_json};
      markers.forEach(function (m) {{
        var pos = new kakao.maps.LatLng(m.lat, m.lng);
        linePath.push(pos);
        var marker = new kakao.maps.Marker({{ position: pos, map: map }});
        var infowindow = new kakao.maps.InfoWindow({{ content: '<div style="padding:6px;font-size:12px;">' + m.name + '</div>' }});
        kakao.maps.event.addListener(marker, 'click', function () {{ infowindow.open(map, marker); }});
      }});
      if (linePath.length > 1) {{
        new kakao.maps.Polyline({{
          path: linePath, map: map, strokeWeight: 4, strokeColor: '#2E7D5B',
          strokeOpacity: 0.8, strokeStyle: 'solid'
        }});
      }}
    }});
  </script>
</body>
</html>"""


@router.get("/map-view", response_class=HTMLResponse)
async def map_view(markers: str = Query(..., description="JSON 배열: [{lat, lng, name}]")):
    """
    카카오맵 JS SDK는 등록된 도메인에서 로드된 페이지인지 확인합니다.
    모바일 앱의 WebView가 순수 HTML 문자열만 불러오면 '출처(origin)'가 없어서
    이 확인을 통과하지 못하므로, 이 백엔드(실제 도메인)에서 지도 페이지를 직접
    내려줘서 그 문제를 우회합니다. 이 서버의 도메인(예: afaf-travel.onrender.com)을
    카카오 개발자 콘솔의 'JavaScript SDK 도메인' 목록에 등록해야 지도가 뜹니다.
    """
    try:
        marker_list = json.loads(markers)
    except (json.JSONDecodeError, TypeError):
        marker_list = []

    center = marker_list[0] if marker_list else {"lat": 37.2836, "lng": 127.017}

    html = _TEMPLATE.format(
        kakao_key=settings.kakao_js_key,
        center_lat=center["lat"],
        center_lng=center["lng"],
        markers_json=json.dumps(marker_list, ensure_ascii=False),
    )
    return HTMLResponse(content=html)
