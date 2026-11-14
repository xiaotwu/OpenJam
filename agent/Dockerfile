FROM python:3.13.18-alpine3.24@sha256:1e1f6334529d1fb26a2ef619d7cffb30a7c7d7cc1cc7338ebee283a58d1aeaca

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --chown=10001:10001 service.py providers.py proposal.py deterministic.py prompt_packs.py ./
COPY --chown=10001:10001 prompts/ ./prompts/
USER 10001:10001
EXPOSE 8091

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + (os.getenv('SHIORI_AGENT_PORT', os.getenv('OPENJAM_AGENT_PORT')) or '8091') + '/healthz', timeout=2).close()"]

ENTRYPOINT ["python", "service.py"]
