"""
pytest가 backend/ 를 import 경로에 넣도록 하는 최소 설정.

이 파일이 여기 있는 것만으로 `from app... import ...`가 동작합니다
(pytest는 conftest.py가 있는 디렉터리를 sys.path 앞에 넣습니다).
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
