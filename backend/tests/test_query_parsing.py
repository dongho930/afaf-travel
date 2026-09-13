"""
자연어 질의에서 지역·동행자·목적을 실제로 뽑아내는지.

예전에는 질의를 후보 목록과 함께 AI에게 통째로 넘기기만 했습니다. 그래서
"수원에서 아이랑 갈 만한 곳"이라고 써도 지역은 화면에서 따로 고른 값만 쓰였고,
동행자는 어디에도 반영되지 않았습니다. 여기서 보는 것은 세 가지입니다.

1. 질의에서 조건이 실제로 뽑히는가
2. 뽑아낸 지역이 진짜 시군구 코드로 확인되는가 (없는 지역은 무시되는가)
3. AI 키가 없거나 한도에 걸려도 규칙 기반으로 대체되는가

AI 호출은 전부 가짜 응답으로 대체하므로 외부 통신이 없습니다.
"""
import asyncio
import json

import pytest

from app.models.schemas import CompanionType, TravelPurpose
from app.services import ai_service
from app.services.sigungu_codes import resolve_sigungu_codes

SUWON_ALL = [41111, 41113, 41115, 41117]  # 수원시 장안·권선·팔달·영통구


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    """파싱 캐시는 모듈 전역이라 테스트끼리 새지 않게 매번 비우고, 기본은 키 없음."""
    ai_service._PARSE_CACHE._entries.clear()
    ai_service._PARSE_CACHE._locks.clear()
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "")


# ---- 지역 이름 -> 시군구 코드 ----

def test_시_이름만_쓰면_그_시의_구를_모두_찾는다():
    assert resolve_sigungu_codes("수원에서 갈 만한 곳") == SUWON_ALL


def test_구_이름까지_쓰면_그_구로_좁힌다():
    assert resolve_sigungu_codes("수원 팔달구 근처 맛집") == [41115]


def test_남양주가_양주로도_잡히지_않는다():
    """긴 이름부터 지워가며 찾지 않으면 '남양주'가 양주시(41630)에도 걸립니다."""
    assert resolve_sigungu_codes("남양주 계곡 가고 싶어") == [41360]


def test_널리_쓰는_동네_이름도_찾는다():
    assert resolve_sigungu_codes("분당에서 점심") == [41135]
    assert resolve_sigungu_codes("일산 카페 추천") == [41285, 41287]


def test_구_이름_단독으로는_지역으로_보지_않는다():
    """'하루 동안'의 '동안'이 안양시 동안구로 잡히면 엉뚱한 지역만 나옵니다."""
    assert resolve_sigungu_codes("하루 동안 다닐 코스") == []


def test_지역_이름을_글자로만_품은_말은_거른다():
    """'고양이'는 고양시가 아니고, '수원화성'은 화성시가 아니라 수원에 있습니다."""
    assert resolve_sigungu_codes("고양이 있는 카페") == []
    assert resolve_sigungu_codes("수원화성 보러 가고 싶어") == SUWON_ALL


def test_지역_언급이_없으면_빈_목록():
    assert resolve_sigungu_codes("경사 없는 산책로 추천해줘") == []


# ---- 규칙 기반 파서 (AI 키가 없을 때) ----

def test_동행자와_목적을_질의에서_읽어낸다():
    parsed = asyncio.run(ai_service.parse_query("아이랑 갈 만한 박물관이랑 맛집 알려줘"))

    assert parsed.companion == CompanionType.FAMILY
    assert TravelPurpose.CULTURE in parsed.purposes
    assert TravelPurpose.FOOD in parsed.purposes
    assert parsed.parsed_by == "rule"


def test_가족과_커플이_같이_걸리면_가족으로_본다():
    """"아이랑 아내랑"처럼 둘 다 걸리는 문장은 가족 여행으로 보는 게 자연스럽습니다."""
    parsed = asyncio.run(ai_service.parse_query("아내랑 아이랑 조용한 공원 가고 싶어"))

    assert parsed.companion == CompanionType.FAMILY


def test_언급이_없으면_동행자는_미지정():
    parsed = asyncio.run(ai_service.parse_query("경사 없는 산책로"))

    assert parsed.companion == CompanionType.UNSPECIFIED
    assert parsed.purposes == [TravelPurpose.REST]  # '산책'


# ---- 지역 결정 규칙 ----

def test_질의에서_읽은_지역이_검색_조건이_된다():
    parsed = asyncio.run(ai_service.parse_query("수원에서 휠체어로 갈 만한 곳"))

    assert parsed.sigungu_cds == SUWON_ALL
    assert parsed.region_source == "query_text"
    assert parsed.region_text == "수원시"


def test_화면에서_고른_지역이_질의보다_우선한다():
    """방금 손으로 고른 지역을 문장 해석이 덮어쓰면 결과를 예측할 수 없습니다."""
    parsed = asyncio.run(ai_service.parse_query("수원 맛집", user_selected_sigungu_cd=41135))

    assert parsed.sigungu_cds == [41135]
    assert parsed.region_source == "user_selected"
    assert parsed.region_text == "성남시 분당구"


def test_지역을_못_찾으면_제한하지_않는다():
    parsed = asyncio.run(ai_service.parse_query("한적한 산책로 추천"))

    assert parsed.sigungu_cds == []
    assert parsed.region_source == "none"
    assert parsed.region_text is None


# ---- AI 파싱 (가짜 Groq 응답) ----

class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": json.dumps(self._payload, ensure_ascii=False)}}]}


class _FakeClient:
    def __init__(self, payload: dict, calls: list, status_code: int = 200):
        self._payload = payload
        self._calls = calls
        self._status_code = status_code

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        self._calls.append(kwargs.get("json"))
        return _FakeResponse(self._payload, self._status_code)


def _patch_groq(monkeypatch, payload: dict, status_code: int = 200) -> list:
    calls: list = []
    monkeypatch.setattr(ai_service.settings, "groq_api_key", "test-key")
    monkeypatch.setattr(
        ai_service.httpx, "AsyncClient", lambda *a, **kw: _FakeClient(payload, calls, status_code)
    )
    return calls


def test_AI가_읽어낸_조건을_그대로_쓴다(monkeypatch):
    _patch_groq(
        monkeypatch,
        {"region": "가평", "companion": "커플", "purposes": ["자연", "사진"], "keywords": ["계곡"]},
    )

    parsed = asyncio.run(ai_service.parse_query("이번 주말에 둘이 다녀올 곳"))

    assert parsed.parsed_by == "ai"
    assert parsed.companion == CompanionType.COUPLE
    assert parsed.purposes == [TravelPurpose.NATURE, TravelPurpose.PHOTO]
    assert parsed.sigungu_cds == [41820]  # 가평군
    assert parsed.region_source == "query_text"


def test_AI가_없는_지역을_지어내면_무시한다(monkeypatch):
    """경기도 밖(제주)은 시군구 표에서 확인되지 않으므로 지역 제한 없이 갑니다."""
    _patch_groq(monkeypatch, {"region": "제주", "companion": "혼자", "purposes": [], "keywords": []})

    parsed = asyncio.run(ai_service.parse_query("혼자 조용히 쉬다 올 곳"))

    assert parsed.sigungu_cds == []
    assert parsed.region_source == "none"
    assert parsed.region_text is None
    assert parsed.companion == CompanionType.SOLO  # 지역만 버리고 나머지는 그대로 씁니다


def test_AI_응답의_이상한_값은_버리고_기본값을_쓴다(monkeypatch):
    _patch_groq(
        monkeypatch,
        {"region": None, "companion": "동호회", "purposes": ["우주여행", "식도락"], "keywords": []},
    )

    parsed = asyncio.run(ai_service.parse_query("맛집 위주로"))

    assert parsed.companion == CompanionType.UNSPECIFIED
    assert parsed.purposes == [TravelPurpose.FOOD]


def test_한도에_걸리면_규칙_기반으로_대체한다(monkeypatch):
    """413(요청이 분당 토큰 한도보다 큼)이어도 파싱이 통째로 실패하면 안 됩니다."""
    _patch_groq(monkeypatch, {}, status_code=413)

    parsed = asyncio.run(ai_service.parse_query("수원에서 아이랑 갈 만한 곳"))

    assert parsed.parsed_by == "rule"
    assert parsed.companion == CompanionType.FAMILY
    assert parsed.sigungu_cds == SUWON_ALL


def test_같은_질의는_다시_묻지_않는다(monkeypatch):
    """1단계와 2단계가 같은 질의를 파싱하므로, AI 호출은 한 번이어야 합니다."""
    calls = _patch_groq(
        monkeypatch, {"region": "수원", "companion": "가족", "purposes": [], "keywords": []}
    )

    first = asyncio.run(ai_service.parse_query("수원에서 아이랑"))
    second = asyncio.run(ai_service.parse_query("수원에서 아이랑"))

    assert len(calls) == 1
    assert first.sigungu_cds == second.sigungu_cds == SUWON_ALL
