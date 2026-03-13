ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=
ARG PIP_TRUSTED_HOST=
ARG APT_MIRROR=
ARG TINYMIST_DOWNLOAD_URL=https://github.com/Myriad-Dreamin/tinymist/releases/download/v0.14.8/tinymist-x86_64-unknown-linux-musl.tar.gz
ARG TINYMIST_VERSION=0.14.8

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN set -eux; \
    if [ -n "$APT_MIRROR" ]; then \
      if [ -f /etc/apt/sources.list ]; then \
        sed -i "s|https\?://deb.debian.org/debian|$APT_MIRROR|g; s|https\?://security.debian.org/debian-security|${APT_MIRROR}-security|g" /etc/apt/sources.list; \
      fi; \
      find /etc/apt/sources.list.d -type f \( -name '*.list' -o -name '*.sources' \) -print0 \
        | xargs -0 -r sed -i "s|https\?://deb.debian.org/debian|$APT_MIRROR|g; s|https\?://security.debian.org/debian-security|${APT_MIRROR}-security|g"; \
    fi; \
    apt-get update && apt-get install -y wget ca-certificates fonts-noto-cjk fonts-liberation fontconfig && \
    wget -q "${TINYMIST_DOWNLOAD_URL}" && \
    tar -xzf tinymist-x86_64-unknown-linux-musl.tar.gz && \
    mv tinymist-x86_64-unknown-linux-musl/tinymist /usr/local/bin/tinymist && \
    rm -rf tinymist-x86_64-unknown-linux-musl tinymist-x86_64-unknown-linux-musl.tar.gz && \
    fc-cache -fv && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY requirements.txt .
RUN pip install --no-cache-dir \
    ${PIP_INDEX_URL:+--index-url=$PIP_INDEX_URL} \
    ${PIP_TRUSTED_HOST:+--trusted-host=$PIP_TRUSTED_HOST} \
    -r requirements.txt

COPY server.py .

EXPOSE 8002

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8002"]
