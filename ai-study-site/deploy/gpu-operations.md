# Orot AI 실습 서버 켜기와 끄기

리전은 서울 `ap-northeast-2`다. AWS 콘솔의 EC2 인스턴스 화면이나 로그인한 CloudShell에서 관리한다. GitHub Actions는 실행 중인 서버에 배포하며 EC2를 켜거나 생성하지 않는다.

| 서버 | 인스턴스 | 역할 | 부팅 후 자동 정지 |
|---|---|---|---|
| 웹 | `i-0c40b75c4fb81e590` | HTTPS·화면·FastAPI | 120분 |
| GPU | `i-095e698c86e8120ac` | Qwen3.5-9B·vLLM | 90분 |

## 실습 시작

웹과 AI를 함께 사용하려면 두 서버를 시작한다. 서버 **시작**은 기존 디스크와 컨테이너를 재사용한다. 새 인스턴스를 만들거나 이미지를 다시 배포할 필요는 없다.

```sh
aws ec2 start-instances --region ap-northeast-2 --instance-ids i-0c40b75c4fb81e590 i-095e698c86e8120ac
aws ec2 describe-instances --region ap-northeast-2 --instance-ids i-0c40b75c4fb81e590 i-095e698c86e8120ac --query 'Reservations[].Instances[].{ID:InstanceId,State:State.Name}'
```

접속 주소는 <https://orot.13.124.182.186.sslip.io>이며 아이디는 `orot`, 비밀번호는 사용자가 직접 설정한 값이다. 모델은 시작 후 가중치를 GPU에 다시 올려야 하므로 EC2가 `running`이어도 즉시 AI를 사용할 수 있는 것은 아니다. 모델 준비 여부는 로그인 후 `/api/meta`의 `model_ready`로 확인한다. 인터넷에는 모델 포트를 공개하지 않는다.

글 읽기와 기본 퀴즈만 필요하면 웹 인스턴스만 시작한다. 메모와 학습 기록은 기존 브라우저의 저장소를 사용하므로 같은 브라우저·프로필로 접속한다.

## 실습 종료

필요한 작업을 마치면 자동 정지를 기다리지 말고 두 서버를 정지한다.

```sh
aws ec2 stop-instances --region ap-northeast-2 --instance-ids i-0c40b75c4fb81e590 i-095e698c86e8120ac
aws ec2 describe-instances --region ap-northeast-2 --instance-ids i-0c40b75c4fb81e590 i-095e698c86e8120ac --query 'Reservations[].Instances[].{ID:InstanceId,State:State.Name}'
```

콘솔에서도 **인스턴스 중지**를 사용한다. **종료**는 GPU 루트 디스크와 모델 캐시를 삭제하므로 실습 종료 방법으로 사용하지 않는다. 정지 중에도 EBS·웹 고정 IP·ECR·Secrets Manager·로그 보관료는 남는다. 월 $25는 승인된 운영예산이며 자동 결제 차단 상한이 아니다. 부팅 후 자동 정지도 월 누적 GPU 실행 시간을 제한하지는 않는다.

## 배포와 상태 확인

- 웹: main의 CI 성공 → ECR → SSM → 공개 HTTPS 버전 확인. 운영 실패 시 이전 릴리스 복구.
- 추론: `Deploy inference to EC2`를 수동 실행하고 `inference_image`에 검증된 ECR digest를 전달한다. 실행 중인 지정 GPU 한 대만 대상으로 한다.
- 추론 로그: CloudWatch `/orot-ai/inference`, 보관 14일.
- 웹 로그: CloudWatch `/orot-ai/application`.
- GPU 모델 캐시: 암호화 100GB gp3의 `/opt/orot-inference/model-cache`. 가중치 네 개의 총 크기는 19,306,310,880 bytes다.
- 모델·정밀도·문맥·동시성 기준: [model-lock.json](inference/model-lock.json). 실제 검증 결과는 [gpu-execution-result.json](gpu-execution-result.json)에 기록한다.

이번 배포에서 수행한 실제 응답 확인은 기능 검증이다. 성능 기준선은 요청 데이터·동시성·입출력 길이·서버 실행 조건을 고정한 별도 실험에서 측정한다.
