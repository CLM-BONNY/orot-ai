# GPU 모델 배포·검증 결과 — 2026-10-26

사용자가 승인한 월 $25 예산과 접근 범위로 **GPU 생성·모델 다운로드·웹 연결·실제 AI 응답·정지/재시작 복구 검증을 완료했다.** 실습 서버 시작·정지 방법은 [운영 문서](gpu-operations.md), 실제 값과 현재 상태는 [실행 기록](gpu-execution-result.json)을 따른다.

**최종 상태:** 2026-10-26 09:56:49 KST에 GPU `stopped`, 웹 `running`을 AWS 조회로 확인했다. GPU는 검증 후 정지했으며, 웹은 같은 날 11:20:02 KST에 자동 정지한다. 이후 상태는 AWS 콘솔에서 확인한다. 다음 AI 실습에서는 기존 GPU를 시작하고 모델 준비를 기다리면 된다.

## 실제 배포와 검증

- GPU: `i-095e698c86e8120ac`, 사설 `10.42.1.31`, `g5.xlarge`·A10G·드라이버 580.178.04. CloudFormation `orot-ai-inference` 생성 완료, 암호화 gp3 100GB 및 웹 보안 그룹에서만 사설 8000 접근 확인.
- [GPU CD 성공](https://github.com/CLM-BONNY/orot-ai/actions/runs/40248135784): 고정 ECR digest → SSM → 모델 다운로드·로딩 → 인증된 모델 준비 상태 확인.
- [최신 웹 CD 성공](https://github.com/CLM-BONNY/orot-ai/actions/runs/40250209702): 운영 코드 `51a8181b378b270a8536bbd6dbe847ff9b1d1bdb`, GPU 사설 주소와 별도 토큰으로 연결. 공개 HTTPS 버전·사이트 인증 확인.
- [최신 CI 성공](https://github.com/CLM-BONNY/orot-ai/actions/runs/40250075621): 백엔드·배포 109개, 프런트 41개 테스트와 운영용 컨테이너 검증 통과.

| 실제 확인 | 결과 | 원본 기록 |
|---|---|---|
| GPU 직접 요청 | 한국어 답변 성공, 토큰 없는 모델 조회 401 | [직접 응답](evidence/2026-10-26/direct-model.json) |
| 웹 AI 공부 도우미 | HTTP 200, 자료 출처를 포함한 grounded 답변 | [온라인 검증](evidence/2026-10-26/service-online.json) |
| AI 복습 퀴즈 | 3문항·보기 4개·정답·해설·출처 및 모델의 2차 검토 통과 | 같은 온라인 검증 기록 |
| 동일 생성 요청 재전송 | 같은 결과 재사용, 중복 생성 없음 | 같은 온라인 검증 기록 |
| GPU 완전 정지 | 웹·학습자료 200, AI는 503 MODEL_UNAVAILABLE | [정지 상태](evidence/2026-10-26/service-offline.json) |
| GPU 재시작 | 동일 캐시에서 로딩 후 실제 답변 복원 | [캐시와 직접 응답](evidence/2026-10-26/warm-direct.json) |
| 재시작 후 최신 웹 API | HTTP 200, 실제 모델 답변 복원 | [웹 복구 검증](evidence/2026-10-26/service-warm.json) |

정지 전환 중 AI 요청이 8초의 클라이언트 제한을 넘기는 문제를 발견해, 모델 연결 대기를 최대 3초로 제한하고 연결 실패를 503으로 분류했다. 연결된 생성 요청의 전체 180초 제한은 유지한다. 회귀 검사를 추가하고 CI·CD 후 실제 중지 상태로 다시 검증했다. 이후 두 번째 정지 전환에서도 [3.037초에 503](evidence/2026-10-26/stop-transition-after.json)을 확인했다. **정지 전환·완전 정지·커널 캐시 등 조건과 표본 수가 달라, 이 단발 관측의 시간 비율을 성능 개선 수치로 사용하지 않는다.**

캐시 검증은 가중치 네 개의 파일 이름·크기·수정 시각 목록 해시가 재시작 전후 같은지 확인한 것이다. 파일 전체 바이트를 다시 해싱한 결과와 구분한다. 총 가중치 크기는 19,306,310,880 bytes이며 모델 commit을 고정했다. AI 복습 문제는 모델의 2차 검토를 통과해도 사람의 확정 상태로 바꾸지 않아 `review_status=unreviewed`를 유지한다.

검증 스크립트는 [gpu_service_smoke.py](scripts/gpu_service_smoke.py)다. 운영 API 컨테이너 내부에서 실행하며 `online`, `offline`, `warm` 모드로 실제 추론을 확인한다. 이 결과는 배포 기능 검증이며, 기존 여섯 가지 품질·성능·부하 실험의 기준선 측정을 완료했다는 뜻은 아니다.

## 준비·승인 이력

- 기존 웹 CD는 [실제 성공 실행](https://github.com/CLM-BONNY/orot-ai/actions/runs/40172193910)에서 ECR 게시·SSM 배포·공개 HTTPS의 버전 확인까지 완료했다. CI만 실행한 상태가 아니다.
- 증액 요청 당시 서울 GPU G/VT On-Demand 한도는 0 vCPU였다. 2026-10-25 16:35:59 KST에 4 vCPU 증액을 요청했다.
- 요청 ID: `8c196c246b6740589b2c833887540fe8mLIBzOKe`, 지원 사례 `179291394000491`. 2026-10-25 18:44:37 KST에 요청 상태 `CASE_CLOSED`, **실제 적용 한도 4 vCPU**를 인증된 AWS 조회로 확인했다. 다음 날 사용자의 정확한 접근 범위 승인을 받은 뒤 생성했다.
- [모델·런타임 고정](inference/model-lock.json), GPU CloudFormation·Compose·호스트 배포·CD 워크플로를 작성했다. 실제 GPU 호환성 검증과 구분한다.
- [추론 이미지 게시](https://github.com/CLM-BONNY/orot-ai/actions/runs/40174875225)는 성공했다. ECR 조회로 digest `sha256:3439097ccb5862dea8bedaf3a63c9becb1bca06200a069585c0219829ff80c78`, 압축 크기 9,268,972,228 bytes를 확인했다. 모델 가중치는 이미지에 포함하지 않았다.
- [해당 코드 CI](https://github.com/CLM-BONNY/orot-ai/actions/runs/40174854809)에서 백엔드·배포 106개, 프런트 41개 테스트와 운영용 컨테이너 HTTP·인증 검증을 통과했다. AWS `validate_template`도 통과했다. GPU 위에서 모델을 실행한 결과는 아니다.
- 사용자가 웹·GPU 합산 월 $25 운영예산(세금 별도)을 승인했다. 2026-10-26 KST에 아래 GPU·웹·GitHub IAM, Secret 및 사설 8000 포트의 정확한 접근 범위도 승인했다. 로그인 복구 후 해당 범위로 실제 배포했다.

## 배포할 구성

| 항목 | 선택 |
|---|---|
| GPU | 서울 `g5.xlarge`, A10G 1개, 4 vCPU·16GiB RAM |
| 이미지 | AWS 공식 AL2023 GPU AMI `ami-0f26145607b7dbd71`, Docker·NVIDIA 런타임 포함 |
| 운영 | ECS agent는 비활성화하고 EC2에서 Docker Compose를 직접 사용 |
| 모델 | `Qwen/Qwen3.5-9B`, 고정 commit `c202236235762e1c871ad0ccb60c8ee5ba337b9a`, Apache 2.0 |
| 가중치 | 공식 저장소 조회 기준 약 19.3GB. 모델 서버에서 직접 다운로드 |
| 추론 | 공식 vLLM 0.17.1, 이미지 digest 고정. BF16·텍스트 전용·문맥 4096·동시 시퀀스 4로 시작 |
| 초기 실행 조건 | thinking 비활성, eager 실행. 추후 성능 개선 실험에서 변경 조건을 별도 기록 |
| 디스크 | 암호화 gp3 100GB에 OS·이미지·모델 캐시 보관. 정지/시작 후 재사용 |
| 네트워크 | 웹 서버 보안 그룹에서 사설 TCP 8000만 허용. GPU 공인 IP는 다운로드·SSM 아웃바운드 용도, 고정 IP 없음 |
| 인증 | AWS가 생성한 별도 추론 토큰을 GPU·웹 instance role만 읽음. GitHub에는 ARN만 전달 |
| 실행 시간 | 매 부팅 후 90분 자동 정지. 초기 다운로드·모델 로딩도 이 시간과 과금에 포함 |
| CD | GPU 전용 수동 릴리스 워크플로가 ECR digest를 SSM으로 전달하고 인증된 `/v1/models` 준비 상태 확인 |

웹 main의 CI 성공 후 자동 CD는 유지한다. GPU는 실행 중인 실험 호스트에만 CD하며 GitHub에 GPU 생성·시작 권한을 부여하지 않는다. GPU 정지 중에도 웹의 기본 학습은 사용할 수 있다. GPU가 준비된 뒤에만 웹을 `openai_compatible`로 변경해 재배포한다.

기존 로컬 GGUF Q4 모델과 GPU BF16은 양자화·런타임 조건이 다르다. 직접적인 개선 전후 비교에서는 동일 모델·정밀도·문맥·동시성 조건을 사용한다.

## 추가 비용 확인

2026-10-25 확인한 서울 On-Demand 가격을 사용한 예시다. 무료 크레딧과 세금을 차감/포함하지 않았다.

| 항목 | 월 예시 |
|---|---:|
| 기존 웹·20GB 디스크·고정 IPv4, 웹 40시간 | $5.994 |
| GPU 5시간 × $1.237 | $6.185 |
| GPU 실행 중 공인 IPv4 5시간 × $0.005 | $0.025 |
| GPU gp3 100GB 보관 × $0.0912 | $9.12 |
| 서버·디스크·IP 합계 | **$21.324** |

ECR 이미지 저장·CloudWatch·Secrets Manager·트래픽·세금은 별도다. 사용자가 승인한 총 운영예산은 **월 $25, 세금 별도**다. 이 예산과 월 5시간 예시는 자동 청구 차단이나 자동 월 누적 시간 제한이 아니다. 기존 웹 단독 월 $10 예산을 대체한다.

최초 설치/검증 세션은 90분 이내로 시작한다. GPU와 실행 중 IPv4만 계산하면 최대 약 $1.863이며 디스크·이미지·로그 등은 별도다. GPU를 정지해도 100GB 디스크 월 $9.12와 이미지·비밀 보관료는 남는다. 상시 GPU 운영은 하지 않는다.

## 승인받아 실제 적용한 접근 범위

- GPU instance role: SSM 관리, 지정 추론 ECR 읽기, 해당 추론 Secret 읽기, `/orot-ai/inference` 로그 전송
- 웹 instance role: 새 추론 Secret 한 개 읽기 추가
- 기존 main 전용 GitHub role: 새로 생성할 GPU EC2 한 대에 SSM 배포 권한 추가. Secret 읽기·EC2 생성/시작 권한 없음
- GPU 보안 그룹: 현재 웹 보안 그룹에서 사설 8000 접근. 인터넷에서 GPU·SSH 포트 접근 불가

## 완료 순서와 실제 검증

1. AWS GPU 할당량 승인·실제 4 vCPU 적용, 비용·접근 범위 승인 — 완료
2. 고정 런타임을 사용하는 추론 이미지를 GitHub Actions에서 ECR에 게시 — 완료
3. GPU 스택 생성, 초기 90분 자동 정지·SSM·Docker·NVIDIA 드라이버 검증 — 완료
4. GPU 전용 CD로 모델 다운로드·로딩, 인증된 모델 준비 상태 확인 — 완료
5. 웹의 사설 추론 주소·모델 이름·Secret ARN 설정 후 기존 웹 CD 재실행 — 완료
6. 실제 공부 도우미 답변과 복습 문제 생성·검토 확인 — 완료. 실제 응답 원본과 스키마·출처·정답 구조 검증을 함께 기록
7. GPU 실제 정지, 웹 기본 기능 유지, 재시작 시 모델 캐시 재사용과 추론 복원 확인 — 완료. 재시작으로 최초 90분 세션이 늘어나지 않도록 원래 종료 시각의 추가 타이머도 적용
8. 기존 6가지 테스트의 통제된 기준선 측정 — **후속 작업**. 배포 기능 검증의 한두 번 응답 시간을 p95·처리량·개선율로 사용하지 않음

## 공식 근거

- [AWS GPU 할당량](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)
- [공식 Qwen 모델](https://huggingface.co/Qwen/Qwen3.5-9B)
- [vLLM 0.17.1](https://github.com/vllm-project/vllm/releases/tag/v0.17.1)
- [공식 GPU AMI의 드라이버·Docker 런타임](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-optimized_AMI.html)
- [서울 EC2 가격 데이터](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.json)
