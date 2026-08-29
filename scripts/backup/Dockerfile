FROM node:22-bookworm-slim AS node-runtime

FROM mariadb:10.6

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

ENTRYPOINT ["/bin/bash"]
