FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11-utils openbox xdotool scrot imagemagick \
    at-spi2-core dbus-x11 \
    python3 python3-venv curl ca-certificates git jq procps \
    && rm -rf /var/lib/apt/lists/*
# Versions are deliberately explicit. agent-desktop is a local Apache-2.0 desktop-control tool; it embeds no model.
RUN npm install -g --no-audit --no-fund agent-desktop@1.1.0 \
    && agent-desktop version >/tmp/agent-desktop-version.json
RUN mkdir -p /opt/private /opt/bops /workspace /var/log/bops \
    && mkdir -p /opt/bops/pw && cd /opt/bops/pw && npm install --no-audit --no-fund @playwright/mcp@0.0.83
COPY private-runtime/worker/display.py /opt/private/display.py
COPY private-runtime/worker/bops-chrome /opt/private/bops-chrome
COPY private-runtime/worker/bops-chrome /usr/local/bin/bops-chrome
COPY private-runtime/worker/desktop-session.sh /opt/private/desktop-session.sh
COPY private-runtime/worker/bops-agent-desktop /usr/local/bin/bops-agent-desktop
COPY private-runtime/worker/bops-agent-desktop-mcp /usr/local/bin/bops-agent-desktop-mcp
COPY vm/bin/bops-screens /usr/local/bin/bops-screens
RUN python3 -m venv /opt/bops/venv && /opt/bops/venv/bin/pip install --no-cache-dir 'mcp==1.26.0'
COPY vm/screen_mcp.py /opt/bops/screen_mcp.py
COPY vm/page-script.cjs /opt/bops/pw/page-script.cjs
COPY vm/browser-front.cjs /opt/bops/pw/browser-front.cjs
RUN ln -s /usr/local/bin/node /usr/bin/node
RUN chmod 755 /opt/private/bops-chrome /opt/private/desktop-session.sh /usr/local/bin/bops-chrome /usr/local/bin/bops-screens /usr/local/bin/bops-agent-desktop /usr/local/bin/bops-agent-desktop-mcp
ENV HOME=/root
WORKDIR /workspace
HEALTHCHECK --interval=3s --timeout=3s --start-period=30s --retries=10 \
  CMD curl -fsS http://127.0.0.1:9299/json/version >/dev/null || exit 1
CMD ["bash", "-lc", "mkdir -p /root/profiles /root/.bops /var/log/bops /workspace/capabilities/skills; exec dbus-run-session -- /opt/private/desktop-session.sh"]
