# 무장애 여행 플래너 — 모바일 앱 MVP

관광약자(휠체어 이용자, 유모차 동반 가족, 고령자, 임산부) 맞춤형 AI 여행 코스 생성 앱입니다.
`backend/`(FastAPI)와 `mobile/`(Expo React Native) 두 개의 프로젝트로 구성되어 있고,
**실제로 동작을 확인**하며 만들었습니다 (아래 "테스트 완료 항목" 참고).

```
afaf-travel/
├── backend/     FastAPI 서버 — 관광 데이터 프록시 + Claude 기반 코스 생성
└── mobile/      Expo(React Native, TypeScript) 모바일 앱
```

---

## 1. 백엔드 실행 방법

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # 선택사항
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

- `http://localhost:8000/health` → `{"status":"ok"}`
- `http://localhost:8000/docs` → Swagger UI로 API 직접 테스트 가능

### 실제 API 키가 없어도 동작합니다
`.env`의 `USE_MOCK_DATA=true`(기본값)일 때는 경기도 관광지 4곳(수원화성, 광교호수공원,
에버랜드, 한국민속촌)에 대한 목업 데이터로 전체 플로우가 동작합니다.
`ANTHROPIC_API_KEY`가 없으면 코스 생성도 규칙 기반 로직으로 자동 대체됩니다.

실제 키를 발급받으면 `.env`에 채우고 `USE_MOCK_DATA=false`로 바꾸면 됩니다:
- **한국관광공사 OpenAPI**: [공공데이터포털](https://www.data.go.kr)에서 "무장애 여행 정보",
  "국문 관광정보서비스", "관광지별 연관 관광지 정보", "관광지 집중률 방문자 추이 예측 정보"
  API 각각 신청 → `TOUR_API_KEY`
- **Claude API**: [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`
- **카카오맵**: [developers.kakao.com](https://developers.kakao.com) → REST API 키(`KAKAO_REST_API_KEY`,
  서버용)와 JavaScript 키(모바일 앱의 `mobile/app.json`의 `extra.kakaoJsKey`)를 각각 발급

> `app/services/tour_api.py`의 `# TODO` 표시된 부분에 실제 API 응답 스키마에 맞춘
> 매핑 로직을 채워 넣으면 실 데이터로 완전히 전환됩니다 (API별 응답 필드는 공공데이터포털
> 명세서를 참고해 채워야 합니다 — 신청 승인 후 실제 응답을 보고 작성하는 것을 권장합니다).

---

## 2. 모바일 앱 실행 방법

```bash
cd mobile
npm install
npx expo start
```

- Expo Go 앱으로 QR코드를 스캔하면 텍스트 입력 → 코스 생성 → 결과 카드까지 바로 확인 가능합니다.
- **음성 입력**(`@react-native-voice/voice`)과 **카카오맵**은 네이티브 모듈이 필요해
  Expo Go에서는 제한적으로 동작합니다. 완전히 쓰려면:
  ```bash
  npx expo prebuild
  npx expo run:ios    # 또는 run:android
  ```
  로 커스텀 개발 빌드(dev client)를 만들어야 합니다. 이 전까지는 텍스트 입력만으로도
  전체 플로우(코스 생성 → 카드 결과)를 테스트할 수 있도록 만들어 두었습니다.
- 앱이 로컬 백엔드(`http://localhost:8000`)를 바라보도록 `app.json`의
  `extra.apiBaseUrl`이 설정되어 있습니다. 실기기에서 테스트할 때는 PC의 IP 주소로 바꿔주세요
  (예: `http://192.168.0.10:8000`).
- 카카오맵 화면을 쓰려면 `app.json`의 `extra.kakaoJsKey`를 발급받은 키로 교체하세요.

---

## 3. 구현된 화면 흐름

1. **온보딩** (`app/index.tsx`) — 휠체어/유모차/고령자/임산부 유형 선택
2. **입력** (`app/input.tsx`) — 텍스트 입력 + 음성 입력(마이크 버튼)
3. **결과** (`app/results.tsx`) — AI가 생성한 코스를 카드 목록으로 표시
   (편의시설 아이콘, 혼잡도 배지, 추천 방문 시간, 인근 의료정보), 오프라인 캐시 자동 복원
4. **지도** (`app/map.tsx`) — 카카오맵 JS SDK를 WebView로 임베드해 마커 + 동선 표시,
   "카카오맵 앱으로 길찾기" 딥링크 버튼

## 4. 아직 손대지 않은 부분 (다음 단계)

- 실제 한국관광공사 OpenAPI 응답 스키마 매핑 (`backend/app/services/tour_api.py`)
- 푸시 알림(FCM) 실제 발송 로직 — `expo-notifications` 의존성은 추가해 두었으나
  서버측 발송 트리거는 아직 미구현
- Supabase 연동 (사용자 계정, 코스 저장 이력) — 현재는 기기 로컬(AsyncStorage) 캐싱만 구현
- 앱 아이콘/스플래시 이미지, 앱스토어/플레이스토어 등록 메타데이터

---

## 테스트 완료 항목

이 환경에서 실제로 서버를 띄워 검증했습니다:
- ✅ `GET /health` → 200 OK
- ✅ `GET /api/tourism/attractions?user_type=wheelchair` → 경사로 보유 관광지만 필터링되어 반환
- ✅ `POST /api/courses/generate` → 혼잡도 낮은 시간대 우선으로 코스(JSON) 생성
- ✅ 모바일 앱의 모든 `.ts`/`.tsx` 파일 문법 검증(esbuild) 통과

모바일 앱은 이 샌드박스에 iOS/Android 시뮬레이터가 없어 실기기/Expo Go 실행은
사용자 환경에서 `npx expo start`로 직접 확인해주셔야 합니다.
