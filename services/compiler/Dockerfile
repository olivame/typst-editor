FROM python:3.11-slim

ARG TYPST_VERSION=0.14.2

RUN apt-get update && apt-get install -y wget xz-utils && \
    wget -q https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz && \
    tar -xf typst-x86_64-unknown-linux-musl.tar.xz && \
    mv typst-x86_64-unknown-linux-musl/typst /usr/local/bin/ && \
    rm -rf typst-x86_64-unknown-linux-musl* && \
    apt-get remove -y wget xz-utils && apt-get autoremove -y && \
    apt-get install -y fonts-noto-cjk fonts-liberation fontconfig && \
    fc-cache -fv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY server.py .

CMD ["python3", "server.py"]
