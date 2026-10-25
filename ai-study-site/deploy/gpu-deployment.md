# GPU 모델 배포 진행 — 2026-10-25

사용자가 웹에 이어 GPU·모델 다운로드·실제 AI 연결까지 배포하도록 요청했다. 이 문서는 기존 웹 단독 배포에 추가되는 범위다. **GPU 서버 생성·모델 다운로드·실제 AI 응답은 아직 완료하지 않았다.**

## 현재 상태

- 기존 웹 CD는 [실제 성공 실행](https://github.com/CLM-BONNY/orot-ai/actions/runs/40172193910)에서 ECR 게시·SSM 배포·공개 HTTPS의 버전 확인까지 완료했다. CI만 실행한 상태가 아니다.
- 서울 GPU G/VT On-Demand 한도는 0 vCPU다. 2026-10-25 16:35:59 KST에 4 vCPU 증액을 요청했다.
- 요청 ID: `8c196c246b6740589b2c833887540fe8mLIBzOKe`, 지원 사례 `179291394000491`. 최근 확인 상태는 `CASE_OPENED`, 적용 한도는 여전히 0이다. AWS 승인 시각은 확정할 수 없다.
- [모델·런타임 고정](inference/model-lock.json), GPU CloudFormation·Compose·호스트 배포·CD 워크플로를 작성했다. 실제 GPU 호환성 검증과 구분한다.
- 현재 승인된 월 $10은 웹 실습 운영예산이다. 아래 GPU 추가 비용과 새 접근 권한은 아직 승인받지 않았다.

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

ECR 이미지 저장·CloudWatch·Secrets Manager·트래픽·세금은 별도다. 제안하는 총 운영예산은 **월 $25, 세금 별도**이며 아직 승인되지 않았다. 이 예산과 월 5시간 예시는 자동 청구 차단이나 자동 월 누적 시간 제한이 아니다. 기존 웹 예산 $10에 GPU 비용이 포함돼 있다고 간주하지 않는다.

최초 설치/검증 세션은 90분 이내로 시작한다. GPU와 실행 중 IPv4만 계산하면 최대 약 $1.863이며 디스크·이미지·로그 등은 별도다. GPU를 정지해도 100GB 디스크 월 $9.12와 이미지·비밀 보관료는 남는다. 상시 GPU 운영은 하지 않는다.

## 실제 생성 전에 확인받을 접근 범위

- GPU instance role: SSM 관리, 지정 추론 ECR 읽기, 해당 추론 Secret 읽기, `/orot-ai/inference` 로그 전송
- 웹 instance role: 새 추론 Secret 한 개 읽기 추가
- 기존 main 전용 GitHub role: 새로 생성할 GPU EC2 한 대에 SSM 배포 권한 추가. Secret 읽기·EC2 생성/시작 권한 없음
- GPU 보안 그룹: 현재 웹 보안 그룹에서 사설 8000 접근. 인터넷에서 GPU·SSH 포트 접근 불가

## 완료 순서와 실제 검증

1. AWS GPU 할당량 승인과 실제 적용 한도 4 이상 확인. 비용·위 접근 범위 승인
2. 고정 런타임을 사용하는 추론 이미지를 GitHub Actions에서 ECR에 게시
3. GPU 스택 생성, 초기 90분 자동 정지·SSM·Docker·NVIDIA 드라이버 검증
4. GPU 전용 CD로 모델 다운로드·로딩, 인증된 모델 준비 상태 확인
5. 웹의 사설 추론 주소·모델 이름·Secret ARN 설정 후 기존 웹 CD 재실행
6. 실제 공부 도우미 답변과 복습 문제 생성·검토를 확인. 가짜 응답이나 HTTP 200만으로 완료 판정하지 않음
7. GPU 실제 정지, 웹 기본 기능 유지, 재시작 시 모델 캐시 재사용과 추론 복원 확인
8. 코드·모델 commit·이미지 digest·인스턴스·추론 조건을 고정해 기존 6가지 테스트의 기준선 측정

## 공식 근거

- [AWS GPU 할당량](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)
- [공식 Qwen 모델](https://huggingface.co/Qwen/Qwen3.5-9B)
- [vLLM 0.17.1](https://github.com/vllm-project/vllm/releases/tag/v0.17.1)
- [공식 GPU AMI의 드라이버·Docker 런타임](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-optimized_AMI.html)
- [서울 EC2 가격 데이터](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.json)
