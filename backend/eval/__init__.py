"""
AI 플래너 추천 품질 평가 도구.

운영 캐시 스냅샷(관광 데이터만)을 불러와 추천 흐름 전체를 로컬에서 돌리고,
질의 세트에 대해 품질 지표를 계산합니다. 공공데이터 API와 Supabase는 부르지 않습니다.

    python -m eval.run --snapshot <스냅샷 폴더> [--seeds 3] [--out 결과.json]

스냅샷 폴더에는 attraction_list_cache.json 등 캐시 테이블을 그대로 내려받은
파일이 있어야 합니다 (저장소에는 넣지 않습니다).
"""
