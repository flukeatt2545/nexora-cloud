FROM codercom/code-server:latest

USER root

# Install system dependencies, PHP, Composer, Node.js, Git
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        php-cli \
        php-mbstring \
        php-xml \
        php-curl \
        php-mysql \
        php-zip \
        composer \
        nodejs \
        npm \
        git \
        curl \
        unzip \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Pre-configure code-server config and VS Code user settings
USER coder
RUN mkdir -p /home/coder/.config/code-server && \
    printf "bind-addr: 0.0.0.0:8080\nauth: none\ncert: false\ndisable-telemetry: true\n" > /home/coder/.config/code-server/config.yaml && \
    mkdir -p /home/coder/.local/share/code-server/User && \
    echo '{\n  "workbench.colorTheme": "Default Dark Modern",\n  "files.autoSave": "afterDelay",\n  "files.autoSaveDelay": 1000,\n  "editor.fontSize": 14,\n  "editor.tabSize": 2,\n  "editor.wordWrap": "on",\n  "terminal.integrated.defaultProfile.linux": "bash",\n  "telemetry.telemetryLevel": "off"\n}' > /home/coder/.local/share/code-server/User/settings.json

USER root
RUN mkdir -p /usr/local/share/nexora-code && \
    cp /home/coder/.local/share/code-server/User/settings.json /usr/local/share/nexora-code/settings.json
COPY nexora-entrypoint.sh /usr/local/bin/nexora-entrypoint.sh
RUN chmod 0555 /usr/local/bin/nexora-entrypoint.sh

USER coder
WORKDIR /home/coder/project

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/nexora-entrypoint.sh"]
