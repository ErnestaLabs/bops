FROM python:3.12-slim
ARG HARNESS2_REF=main
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone --depth=1 https://github.com/google-research/harness2.git harness2
WORKDIR /opt/harness2
RUN pip install --no-cache-dir -e '.[render]'
ENV HARNESS2_RUNS_DIR=/data/runs
VOLUME ["/data"]
ENTRYPOINT ["harness2"]
