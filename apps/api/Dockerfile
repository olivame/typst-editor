ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}

ARG PIP_INDEX_URL=
ARG PIP_TRUSTED_HOST=

WORKDIR /usr/src/app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir \
    ${PIP_INDEX_URL:+--index-url=$PIP_INDEX_URL} \
    ${PIP_TRUSTED_HOST:+--trusted-host=$PIP_TRUSTED_HOST} \
    -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "run-dev.sh"]
