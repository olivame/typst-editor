ARG PYTHON_BASE_IMAGE=python:3.11-slim
FROM ${PYTHON_BASE_IMAGE}

ARG APT_MIRROR=
ARG TYPST_DOWNLOAD_URL=https://github.com/typst/typst/releases/download/v0.14.2/typst-x86_64-unknown-linux-musl.tar.xz
ARG TYPST_VERSION=0.14.2

RUN set -eux; \
    if [ -n "$APT_MIRROR" ]; then \
      if [ -f /etc/apt/sources.list ]; then \
        sed -i "s|https\?://deb.debian.org/debian|$APT_MIRROR|g; s|https\?://security.debian.org/debian-security|${APT_MIRROR}-security|g" /etc/apt/sources.list; \
      fi; \
      find /etc/apt/sources.list.d -type f \( -name '*.list' -o -name '*.sources' \) -print0 \
        | xargs -0 -r sed -i "s|https\?://deb.debian.org/debian|$APT_MIRROR|g; s|https\?://security.debian.org/debian-security|${APT_MIRROR}-security|g"; \
    fi; \
    apt-get update && apt-get install -y wget xz-utils && \
    wget -q "${TYPST_DOWNLOAD_URL}" && \
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
