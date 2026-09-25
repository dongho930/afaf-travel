"""
평가 질의 세트. 유형 7종 × (지역 선택 여부, 방문일, 문장 종류)를 골고루 섞었습니다.

방문일: 2026-10-05(월, 박물관·미술관 휴관이 많은 날), 2026-10-03(토), 2026-10-07(수).
모두 '고른 조건과 문장이 어긋나지 않는' 질의입니다 (어긋나는 경우는 단위 테스트가 봅니다).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class EvalQuery:
    id: str
    user_type: str
    text: str
    sigungu_cd: int | None = None
    visit_date: str | None = None


MON, SAT, WED = "2026-10-05", "2026-10-03", "2026-10-07"
SUWON_PALDAL, BUNDANG, ILSAN_E, HWASEONG = 41115, 41135, 41285, 41590
GAPYEONG, YANGPYEONG, YONGIN_CHEOIN, ICHEON, GWANGJU, UIJEONGBU = 41820, 41830, 41461, 41500, 41610, 41150

QUERIES: tuple[EvalQuery, ...] = (
    # 지체 장애인
    EvalQuery("w1", "wheelchair", "호수 보면서 산책할 곳"),
    EvalQuery("w2", "wheelchair", "역사 유적 둘러보고 점심은 식당에서", SUWON_PALDAL),
    EvalQuery("w3", "wheelchair", "박물관이나 미술관 추천해줘", BUNDANG, MON),
    EvalQuery("w4", "wheelchair", "주차 편하고 장애인 화장실 있는 공원", None, SAT),
    EvalQuery("w5", "wheelchair", "자연 속에서 쉬고 싶어", GAPYEONG),
    EvalQuery("w6", "wheelchair", "가까운 곳끼리 짧은 동선으로 다니고 싶어", ILSAN_E),
    EvalQuery("w7", "wheelchair", "맛집 추천해줘"),
    # 고령자
    EvalQuery("s1", "senior", "계단 없이 다닐 수 있는 역사 유적", SUWON_PALDAL),
    EvalQuery("s2", "senior", "엘리베이터 있는 전시관", None, WED),
    EvalQuery("s3", "senior", "쉴 곳 많은 산책로", YANGPYEONG),
    EvalQuery("s4", "senior", "한적하고 조용한 곳"),
    EvalQuery("s5", "senior", "온천이나 휴양하기 좋은 곳"),
    EvalQuery("s6", "senior", "수목원 구경하고 점심 먹을 곳", GWANGJU),
    # 영유아 가족
    EvalQuery("f1", "stroller", "아이랑 체험할 수 있는 곳"),
    EvalQuery("f2", "stroller", "수유실 있는 실내 놀거리", BUNDANG),
    EvalQuery("f3", "stroller", "유모차 대여되는 공원", HWASEONG, SAT),
    EvalQuery("f4", "stroller", "기저귀 교환대 있는 식당"),
    EvalQuery("f5", "stroller", "동물 보러 가고 싶어", ILSAN_E),
    EvalQuery("f6", "stroller", "아이랑 박물관", None, MON),
    # 임산부
    EvalQuery("p1", "pregnant", "주차 편하고 쉴 곳 있는 공원"),
    EvalQuery("p2", "pregnant", "화장실 가깝고 오래 걷지 않는 코스", SUWON_PALDAL),
    EvalQuery("p3", "pregnant", "태교에 좋은 전시나 공연", None, MON),
    EvalQuery("p4", "pregnant", "숲길 산책", YANGPYEONG),
    EvalQuery("p5", "pregnant", "수유실 있는 쇼핑몰"),
    # 시각 장애인
    EvalQuery("v1", "visual", "점자 안내 있는 전시 보고 싶어"),
    EvalQuery("v2", "visual", "음성 안내 있는 박물관", BUNDANG),
    EvalQuery("v3", "visual", "안내견이랑 갈 수 있는 곳"),
    EvalQuery("v4", "visual", "역사 체험", SUWON_PALDAL),
    EvalQuery("v5", "visual", "산책하기 좋은 공원", None, SAT),
    # 청각 장애인
    EvalQuery("h1", "hearing", "자막 안내 있는 전시"),
    EvalQuery("h2", "hearing", "수어 해설 있는 곳"),
    EvalQuery("h3", "hearing", "조용히 산책할 곳"),
    # 일반
    EvalQuery("g1", "general", "야경 보기 좋은 곳"),
    EvalQuery("g2", "general", "계곡이랑 맛집", GAPYEONG),
    EvalQuery("g3", "general", "도자기 체험하고 쌀밥 먹기", ICHEON),
    EvalQuery("g4", "general", "쇼핑하고 카페", None, SAT),
    EvalQuery("g5", "general", "비 오는 날 실내에서 놀 곳"),
    EvalQuery("g6", "general", "부대찌개 맛집이랑 공원", UIJEONGBU),
    EvalQuery("g7", "general", "놀이공원 가고 싶어", YONGIN_CHEOIN),
)
