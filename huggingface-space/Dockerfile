# Hugging Face Space — Docker SDK runtime.
# Listens on port 7860 (HF Spaces convention).
FROM python:3.11-slim

# OpenCV needs a couple of native libs even with -headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces map their public URL to container port 7860.
EXPOSE 7860

# `uvicorn app:app` boots our FastAPI service (cf. app.py).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
