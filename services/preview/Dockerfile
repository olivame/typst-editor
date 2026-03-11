FROM python:3.12-slim

ARG TINYMIST_VERSION=0.14.8

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y wget ca-certificates fonts-noto-cjk fonts-liberation fontconfig && \
    wget -q https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}/tinymist-x86_64-unknown-linux-musl.tar.gz && \
    tar -xzf tinymist-x86_64-unknown-linux-musl.tar.gz && \
    mv tinymist-x86_64-unknown-linux-musl/tinymist /usr/local/bin/tinymist && \
    rm -rf tinymist-x86_64-unknown-linux-musl tinymist-x86_64-unknown-linux-musl.tar.gz && \
    fc-cache -fv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8002

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8002"]
