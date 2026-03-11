FROM python:3.11-slim

RUN apt-get update && apt-get install -y wget xz-utils && \
    wget -q https://github.com/typst/typst/releases/download/v0.11.0/typst-x86_64-unknown-linux-musl.tar.xz && \
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
