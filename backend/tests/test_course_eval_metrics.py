"""코스 평가 지표 계산 — 최단 순서 대비 비율과 경로 꼬임을 제대로 세는지."""

from app.models.schemas import Attraction
from eval.course_eval import _best_km, _crossings, _path_km


def spot(cid, lat, lng):
    return Attraction(content_id=cid, name=cid, category="관광지", address="경기도", latitude=lat, longitude=lng)


# 동서로 한 줄에 놓인 네 곳 (A-B-C-D)
A, B, C, D = spot("A", 37.5, 127.00), spot("B", 37.5, 127.05), spot("C", 37.5, 127.10), spot("D", 37.5, 127.15)


def test_한_줄로_가면_최단과_같음():
    assert abs(_path_km([A, B, C, D]) - _best_km([D, B, A, C])) < 1e-9


def test_왔다_갔다_하면_최단보다_김():
    assert _path_km([A, C, B, D]) > _best_km([A, B, C, D]) * 1.2


def test_경로가_교차하면_꼬임으로_셈():
    top_left, top_right = spot("TL", 37.6, 127.0), spot("TR", 37.6, 127.1)
    bottom_left, bottom_right = spot("BL", 37.5, 127.0), spot("BR", 37.5, 127.1)
    assert _crossings([top_left, bottom_right, top_right, bottom_left]) == 1  # X자
    assert _crossings([top_left, top_right, bottom_right, bottom_left]) == 0  # ㄷ자
