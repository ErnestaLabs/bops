#!/usr/bin/env bash
set -euo pipefail
export XDG_RUNTIME_DIR=/tmp/ernesta-xdg
export DISPLAY=:99
mkdir -p "$XDG_RUNTIME_DIR" /root/.agent-desktop
chmod 700 "$XDG_RUNTIME_DIR" /root/.agent-desktop
/usr/libexec/at-spi-bus-launcher --launch-immediately >/var/log/bops/atspi.log 2>&1 &
cat > /tmp/agent-desktop-session.env <<EOF
export XDG_RUNTIME_DIR='$XDG_RUNTIME_DIR'
export DBUS_SESSION_BUS_ADDRESS='$DBUS_SESSION_BUS_ADDRESS'
EOF
chmod 600 /tmp/agent-desktop-session.env
python3 /opt/private/display.py boot
exec sleep infinity
