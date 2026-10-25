FROM python:3.11-slim

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and evaluation modules
COPY . /app/ml-sidecar
WORKDIR /app/ml-sidecar

ENV PYTHONPATH="/app/ml-sidecar"
ENV PORT=8000
ENV HOST="0.0.0.0"

EXPOSE 8000

CMD ["uvicorn", "ml_sidecar.main:app", "--host", "0.0.0.0", "--port", "8000"]
