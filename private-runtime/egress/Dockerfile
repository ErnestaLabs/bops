FROM node:22-bookworm-slim
WORKDIR /opt/ernesta
COPY private-runtime/network-policy.mjs ./network-policy.mjs
COPY private-runtime/egress/policy.mjs private-runtime/egress/server.mjs ./egress/
USER node
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3128/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "egress/server.mjs"]
