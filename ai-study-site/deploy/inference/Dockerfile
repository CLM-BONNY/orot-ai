# syntax=docker/dockerfile:1
# Set to an officially published vLLM image pinned by digest after model/GPU selection.
ARG VLLM_BASE_IMAGE
FROM ${VLLM_BASE_IMAGE}
COPY ai-study-site/deploy/inference/launch.py /opt/orot/launch.py
ENV HF_HOME=/models/huggingface HF_HUB_CACHE=/models/huggingface/hub
EXPOSE 8000
ENTRYPOINT ["python3", "/opt/orot/launch.py"]
