# Orot AI 배포 — 웹 상시, GPU는 실험할 때만

2026-10-19. 사용자 결정: 도메인·HTTPS·Docker·GitHub CI/CD를 갖춘 AWS 서비스에서 평가한다. 비용을 낮추기 위해 웹은 상시 운영하고 GPU는 실험할 때만 켠다.

**현재 상태:** [GitHub 저장소](https://github.com/CLM-BONNY/orot-ai) 생성·push 완료. 2026-10-25 GitHub API에서 현재 공개 저장소임을 확인했다. [이전 CI](https://github.com/CLM-BONNY/orot-ai/actions/runs/39220350945)에서 자동 테스트 128개(백엔드/배포 87·프런트 41), 인프라 lint, 실제 web/API Docker 빌드·HTTP 통합·인증·Caddy 설정 검증 통과. EC2 배포 코드는 준비했지만 AWS 리소스·도메인·GPU 모델은 아직 생성하거나 구매하지 않았다. [검증 기록](preparation-result.json)

2026-10-25 사용자가 실제 배포를 요청했다. 웹 기본값을 `t3.small`로 바꾸고 정밀 측정용 `m7i.large`를 선택할 수 있도록 반영했다. T3에만 standard CPU 크레딧 설정을 적용한다. 기존 콘솔 세션이 만료되어 AWS 재로그인을 요청한 상태이며, 로컬 AWS 자격 증명은 없다. `DEPLOY_ENABLED=false`를 유지하고 있다.

## 현재 배포 구성

```mermaid
flowchart LR
    U[브라우저] --> D[도메인 DNS]
    D --> C[Caddy HTTPS]
    subgraph CPU[상시 EC2 · Docker Compose]
      C --> W[Nginx 프런트 이미지]
      W --> A[FastAPI 이미지]
    end
    A --> G[실험할 때만 켜는 GPU EC2 · vLLM 이미지]
    G --> E[EBS 모델 캐시]
    CPU --> L[CloudWatch]
```

- 기본 웹 서버: x86 `t3.small`(2GB). 빌드는 CI에서 수행하고 서버는 완성 이미지만 실행한다. T3 크레딧 모드는 standard로 두고 추가 Unlimited 크레딧 비용을 사용하지 않는다. 성능 실험에는 크레딧 상태도 기록한다. 정밀 측정 시 `m7i.large`(2 vCPU·8GB)를 선택할 수 있으며 개선 전후는 같은 유형으로 고정한다.
- 프런트·API·추론은 각각 이미지다. 초기 배포에서 프런트와 API는 같은 CPU EC2의 별도 컨테이너로 실행한다. 모델은 별도 GPU EC2에서 실행한다.
- Caddy가 도메인 HTTPS 인증서를 자동 발급·갱신한다. HTTP/HTTPS만 공개하고 SSH·API·모델 포트는 인터넷에 열지 않는다.
- GPU는 같은 VPC의 사설 주소로만 API 요청을 받는다. 다운로드와 관리에 사용하는 아웃바운드 통신은 별도로 필요하다. 첫 구성에서는 NAT Gateway·ALB·Fargate 비용을 추가하지 않는다.
- GPU가 꺼져 있어도 글·기본 퀴즈·메모·저장된 AI 세트는 사용할 수 있다. 새로운 AI 답변·문제 생성은 실제 연결 오류를 안내한다.
- 단일 CPU 서버의 Compose 교체 배포에는 짧은 중단이 생길 수 있다. 무중단·고가용성을 구현했다고 주장하지 않는다.
- 초기 사이트는 비밀번호로 보호한다. UI와 GPU 호출 API를 Nginx에서 함께 보호하고, 배포 확인용 health/release 경로만 인증 없이 읽을 수 있다.
- Nginx의 AI 경로는 IP별 분당 6건·burst 2 제한을 기본으로 둔다. 실험할 때 요청 제한과 애플리케이션의 1개 AI 동시 실행 제한을 기록한다.

`alternatives/ecs/`는 초기에 검토한 ECS+ALB 방식이다. 비용 선호에 따라 현재 배포 경로에서 제외했으며 활성 워크플로가 실행하지 않는다. 기존 S3·CloudFront/Lambda 설계도 최초 배포에는 쓰지 않는다. CDN·다중 서버는 이후 비교 실험으로 추가할 수 있다.

## 비용 견적

[계산식과 AWS 공식 원본 요금](cost-estimate.json). 서울 리전 Linux On-Demand, 2026-10-25 공식 가격 피드 재확인. 리전은 실제 배포 전에 계정의 가용 용량·GPU 할당량과 함께 확인한다.

| 항목 | 견적 |
|---|---:|
| 웹 `t3.small` 730시간 | $18.98/월 |
| 웹 gp3 20GB | $1.82/월 |
| 웹 공인 IPv4 730시간 | $3.65/월 |
| GPU 캐시용 gp3 100GB 유지 | $9.12/월 |
| GPU 후보 `g5.xlarge` | $1.237/실행 시간 |
| GPU 실행 중 공인 IPv4 | $0.005/시간 |

위 항목만 합친 소계는 GPU 월 10시간 약 **$45.99**, 20시간 약 **$58.41**다. 웹 서버·20GB 디스크·웹 공인 IP만의 소계는 월 $24.45다. 정밀 측정용 `m7i.large` CPU 실행 요금은 시간당 $0.1239이며 부하 발생기와 함께 별도 사용량을 계산한다. 도메인 등록/갱신·DNS·Secrets Manager·ECR·CloudWatch·트래픽·세금·환율·무료 크레딧은 미반영이다. 청구 총액이나 확정 예산 상한이 아니다. GPU 캐시를 보관하면 GPU를 꺼도 디스크 비용이 남는다. 모델에 필요한 GPU/디스크 크기에 따라 견적이 달라진다.

도메인 후보는 `orot-ai.dev`다. 2026-10-19 Route 53 Domains API 조회에서 등록 가능하며 등록·갱신 각각 연 $17이었다. 처음 검토한 `.study`는 Route 53 등록 미지원, `orot-ai.com`은 등록 불가였다. 구매 직전 가격·가용 여부를 다시 확인하며 아직 구매하지 않았다. 도메인 구매는 기술적 필수 조건은 아니지만 이번 완료 기준에는 포함한다. 실제 구매·유료 리소스 생성 전 예상 비용과 사용 상한을 확정한다.

월 운영예산 $50(세금 별도), GPU 월 10시간 목표·회당 최대 60분, 도메인 1년 $17을 별도로 제안했으며 **아직 비용 승인을 받지 않았다**. 월 GPU 10시간은 계획상의 목표이고 누적 시간 자동 차단은 아직 구현하지 않았다. 예산 알림도 결제 차단 기능이 아니다.

## 실제 AWS 계정 사전 점검

[읽기 전용 점검 기록](account-preflight.json), 2026-10-19. 사용자 로그인 후 기존 AWS CloudShell 세션으로 조회했으며 자격 증명을 로컬로 내보내지 않았다.

- 서울 리전 `ap-northeast-2` 접속 확인. 이 리전 EC2 0개·Elastic IP 0개.
- 일반 On-Demand vCPU 한도 5: 제안한 웹 서버 1대에 충분하다.
- G/VT On-Demand vCPU 한도 **0**: GPU 생성 전 증액이 필요하며 기존 증액 요청은 없었다. `g5.xlarge` 또는 `g4dn.xlarge` 한 대 후보에 필요한 4 vCPU를 요청할 계획이다. 아직 제출하지 않았다.
- 두 GPU 유형은 서울 리전 제공 목록에 있지만 즉시 가용 용량·모델 적합성은 검증하지 않았다.
- IAM OIDC provider가 없어 GitHub 배포용 provider와 main 전용 Role 생성이 필요하다. 실제 생성 권한·배포 성공은 아직 검증하지 않았다.
- 현재 콘솔은 root 세션이다. 기존 로그인으로 사전 조회만 했고 새 장기 액세스 키를 만들지 않았다.
- GPU 증액 대기 중에도 웹·기본 학습 기능의 배포를 먼저 진행할 수 있다. AI 배포 완료 판정은 실제 GPU 호출 후에 한다.

## Git과 이미지

- GitHub: 소스·Dockerfile·Compose·CI/CD·인프라·평가 코드
- ECR: `orot-ai-web`, `orot-ai-api`, `orot-ai-inference`
- 이미지 태그: Git SHA + Actions 실행 ID + 재실행 번호. 배포는 불변 `repository@sha256:...` 사용
- 베이스 Python·Node·Nginx·Caddy 이미지와 공식 Action은 확인한 digest/commit으로 고정
- 모델 가중치는 Git/앱 이미지에 넣지 않고 GPU EBS에 다운로드한다. 모델 저장소·체크포인트 commit·vLLM 이미지 digest는 모델/GPU 선택 후 고정한다.
- `.env.local`, `.env.docker`, 가중치·개인키·캐시는 Git과 Docker 빌드 컨텍스트에서 제외한다.

## 로컬 Docker와 CI

저장소 루트에서 다음 명령으로 웹/API 컨테이너를 실행한다. 기본 주소는 `http://127.0.0.1:5180`이다.

```sh
docker compose -f ai-study-site/deploy/compose.yml up --build --wait
python3 ai-study-site/deploy/scripts/container_smoke.py
```

이 Mac에는 Docker가 없어 실제 컨테이너 검증은 GitHub Actions Linux runner에서 수행한다. 기본 Compose는 모델을 다운로드·시작하지 않는다. 별도로 실행한 Mac Ollama를 `host.docker.internal:11535`로 연결하도록 되어 있으나 Docker Desktop 호스트 접근 설정과 실제 모델 연결은 별도 확인해야 한다.

CI는 Python/프런트 테스트·빌드, CloudFormation lint, 실제 Docker 빌드·기동, 전체 콘텐츠/문제/직접 경로/오류의 프록시 통합, Caddy 설정, 사이트 비밀번호 보호를 검사한다. 인증 테스트는 폐기 가능한 고정 fixture만 사용한다. GPU는 CI에서 실행하지 않으며 CI 성공을 AI 품질·GPU 성능 검증으로 해석하지 않는다.

## 웹 CI/CD

`.github/workflows/deploy.yml`은 실제 인프라 준비 후 `DEPLOY_ENABLED=true`로 활성화한다. 현재는 비활성 상태다.

1. main push의 CI 성공 → 정확한 Git SHA checkout. PR·다른 저장소 이벤트는 배포하지 않는다.
2. 테스트·CPU 컨테이너 통합 점검 후 GitHub OIDC로 제한된 AWS Role을 사용한다.
3. 테스트한 이미지를 ECR에 push하고 digest를 읽는다.
4. SSM Run Command로 CPU EC2에 릴리스 파일을 전달한다. SSH 키와 GitHub 토큰을 EC2에 전달하지 않는다.
5. EC2가 instance role로 ECR 이미지를 pull하고 Secrets Manager에서 비밀을 읽는다. GitHub/SSM 명령 본문에 비밀 값을 넣지 않는다.
6. Compose 교체 후 로컬 health/release와 공개 HTTPS의 Git SHA 일치를 확인한다. 실패하면 이전 릴리스로 되돌린다. 첫 배포는 이전 버전이 없어 롤백할 수 없다.
7. 성공 릴리스의 Git SHA·이미지 digest·결과를 Actions artifact로 남긴다.

비밀은 EC2의 root 전용 릴리스 디렉터리에 파일로 보관하고 해당 컨테이너에만 읽기 전용으로 mount한다. 파일의 컨테이너 읽기 권한과 호스트 상위 디렉터리 권한을 구분한다. 이전 릴리스의 비밀 파일을 보존해 코드 롤백 때 함께 사용한다. 디스크 암호화와 instance role의 최소 권한을 사용한다.

필요한 GitHub 변수:

| 변수 | 용도 |
|---|---|
| `DEPLOY_ENABLED` | 인프라 준비 전 `false` |
| `AWS_REGION` | 실제 리전 |
| `AWS_DEPLOY_ROLE_ARN` | 이 저장소 main만 신뢰하는 OIDC Role |
| `APP_INSTANCE_ID` | CPU EC2 |
| `APP_DOMAIN` | 등록·연결한 도메인, scheme 없이 입력 |
| `INFERENCE_BASE_URL` | GPU 사설 IP의 `http://주소:8000/v1` |
| `MODEL_NAME` | 추론 서버의 served model name |
| `INFERENCE_SECRET_ARN` | 모델 인증 토큰 Secret ARN |
| `SITE_LOGIN_SECRET_ARN` | htpasswd 로그인 Secret ARN |

현재 이 Mac에 AWS CLI/자격 증명이 설정돼 있지 않다. 기존 콘솔의 CloudShell로 계정 사전 조회는 완료했고, 실제 리소스와 OIDC 신뢰 claim은 생성·배포 단계에서 확인해야 한다. OIDC 템플릿은 저장소/소유자 ID 및 main branch를 제한한다. 계정 전체 관리자 권한을 GitHub에 주지 않는다.

## GPU 실험 운영

- `inference.yml`은 검증한 공식 vLLM base digest를 받아 추론 이미지를 빌드·ECR에 게시하는 수동 워크플로다. 실제 GPU 배포·체크포인트 설정은 아직 미완료다.
- `compose.gpu.yml`은 Linux·NVIDIA Container Toolkit용 예시다. 기본 포트는 loopback에만 열려 있다. 실제 배포 시 GPU 사설 IP로 bind하고 SG는 CPU 서버에서만 허용한다.
- GPU 인스턴스와 모델을 준비한 뒤 `ec2/gpu_session.py start --instance-id ... --minutes 60`으로 제한된 세션을 시작한다. 지정 태그·shutdown=stop을 확인하고 종료 예약 실패 시 인스턴스를 정지한다. 세션 후에는 AWS 상태가 실제 stopped인지 확인한다.
- 해당 스크립트는 GPU/SSM의 실제 환경 검증을 아직 하지 않았다. 단위 테스트는 다른 인스턴스 오작동 방지·세션 범위·종료 예약 실패 시 정지를 확인한다. AWS Budget 알림도 청구 차단 장치가 아니다.
- 모델/인스턴스 생성·다운로드·준비 상태·시작/정지·종료 예약을 실제 검증한 후 사용한다. 로컬 GGUF 모델과 GPU 체크포인트 결과는 따로 기록한다.

## 인프라 파일과 남은 순서

| 파일 | 준비한 내용 | 아직 필요한 것 |
|---|---|---|
| `cloudformation/registry.yml` | 불변 ECR 3개 | AWS 연결 후 생성 |
| `cloudformation/web-ec2.yml` | VPC·서브넷·CPU EC2·고정 IP·SG·SSM role·로그·선택 DNS | 계정/비밀/도메인 준비, 실제 생성·bootstrap 확인 |
| `cloudformation/github-oidc.yml` | ECR push·지정 EC2 배포만 허용하는 main 전용 Role | 계정의 OIDC provider 확인 |
| `ec2/compose.yml`, `Caddyfile` | CPU 서비스·HTTPS·로그·접근 제한 | 실제 서버에서 검증 |
| GPU | Docker 실행 정의·세션 제어 준비 | 모델/GPU 선택·인프라·다운로드·실제 기동 검증 |

다음 순서로 진행한다.

1. 예상 비용·월 GPU 사용 시간 상한을 확정하고 AWS 계정을 안전하게 연결한다. 키를 채팅이나 Git에 붙여 넣지 않는다.
2. 도메인 가능 여부·등록/갱신 가격을 확인하고 구매·DNS를 설정한다.
3. ECR·웹 EC2·비밀·OIDC를 생성하고 SSM/bootstrap 상태를 검증한다.
4. 모델·GPU·할당량·라이선스·vLLM 호환성을 확인하고 GPU를 구성한다.
5. 최초 배포, 실제 AI 호출, GPU 정지 중 기본 기능, TLS·재시작·롤백·비용 제어를 검증한다.
6. CI/CD를 활성화하고 성공한 배포 버전을 고정한 뒤 1~6번 평가와 스터디 성능 실험을 진행한다.

사이트 주소가 바뀌면 IndexedDB가 자동 이동하지 않는다. 기존 주소에서 JSON 백업 후 새 도메인에서 가져온다.

## 공식 근거

- [EC2 가격](https://aws.amazon.com/ec2/pricing/on-demand/) · [서울 EC2 공식 요금 데이터](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.json)
- [EC2 정지·시작과 디스크 보존](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html)
- [SSM Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html)
- [Caddy 자동 HTTPS](https://caddyserver.com/docs/automatic-https)
- [ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html)
- [GitHub AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [vLLM Docker](https://docs.vllm.ai/en/stable/deployment/docker/)
