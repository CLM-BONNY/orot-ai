# 오롯 AI · Orot AI

개념을 읽고 퀴즈를 풀며 AI Engineer의 기초를 공부하는 개인 학습 서비스입니다.

- React·TypeScript 읽기 화면, 8개 트랙·32개 챕터·96개 학습 페이지
- 객관식·인출 연습, 오답 재풀이·별표·개념 메모·JSON 백업
- FastAPI → 자체 호스팅 Qwen 공부 도우미와 복습 문제 생성
- GitHub Actions 테스트 및 Docker 웹/API 통합 점검

[서비스 아키텍처](service-architecture.md) · [앱 실행](ai-study-site/README.md) · [저비용 AWS 배포 계획과 진행 상태](ai-study-site/deploy/README.md) · [학습 콘텐츠](learning-content/README.md)

## 로컬 실행

Python 의존성과 `ai-study-site/frontend`의 npm 의존성을 설치한 뒤 앱 폴더에서 `python3 run_local.py --production`을 실행합니다. 먼저 `frontend`에서 `npm run build`가 필요합니다. 기존 모델의 로컬 경로는 `.env.local`에서 설정하고 Git에 올리지 않습니다.

Docker 설치 후에는 저장소 루트에서 다음 명령으로 웹/API를 별도 컨테이너로 실행할 수 있습니다.

```sh
docker compose -f ai-study-site/deploy/compose.yml up --build --wait
```

주소는 `http://127.0.0.1:5180`입니다. 기본 Compose는 모델을 다운로드하거나 시작하지 않습니다. 기존 Mac의 Ollama를 별도로 실행하면 AI가 연결되며, 모델이 없어도 기본 학습 기능은 동작합니다.

## 현재 상태

서울 `t3.micro`에 실습용 웹 배포를 완료했습니다. 주소는 `https://orot.13.124.182.186.sslip.io`이며 유료 도메인·GPU를 만들지 않습니다. 웹도 실습할 때만 실행하고 매 부팅 120분 뒤 자동 정지합니다. 월 $10 운영예산(세금 별도, 자동 결제 차단 아님)이 승인됐습니다. 실제 HTTPS·사용자 로그인·실패 배포 복구·정지/재시작을 확인했습니다. [배포 기록과 시작/중지 방법](ai-study-site/deploy/README.md)을 참고하세요. 기본 학습은 웹 실행 중 사용할 수 있고 새 AI 생성은 비활성 상태입니다. 브라우저별 IndexedDB 기록은 주소 변경 전 JSON으로 백업해야 합니다.
