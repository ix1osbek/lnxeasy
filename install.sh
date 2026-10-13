#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="ix1osbek/lnxeasy"
REF="${LNXEASY_REF:-main}"
NODE_LINE="latest-v22.x"

INSTALL_DIR="${LNXEASY_INSTALL_DIR:-/opt/lnxeasy}"
CONFIG_DIR="/etc/lnxeasy"
CONFIG_FILE="$CONFIG_DIR/lnxeasy.env"
UNIT_FILE="/etc/systemd/system/lnxeasy.service"
SERVICE_USER="lnxeasy"
DEFAULT_PORT="4321"

say() {
    printf '%s\n' "$*"
}

fail() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        fail "The \"$1\" command is required. Install it and run this script again."
    fi
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        fail "This script must run as root. Try: curl -fsSL https://raw.githubusercontent.com/$REPOSITORY/main/install.sh | sudo bash"
    fi
}

detect_node_arch() {
    case "$(uname -m)" in
        x86_64) say "x64" ;;
        aarch64 | arm64) say "arm64" ;;
        *) fail "Unsupported CPU architecture: $(uname -m). Supported: x86_64 and aarch64." ;;
    esac
}

check_system() {
    if [ "$(uname -s)" != "Linux" ]; then
        fail "lnxeasy runs on Linux only."
    fi

    require_command curl
    require_command tar
    require_command sha256sum
}

check_systemd() {
    if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
        fail "systemd is required to run lnxeasy as a service, and it was not found on this machine."
    fi
}

download_node() {
    local arch base_url sums line checksum file_name work_dir

    arch="$(detect_node_arch)"
    base_url="https://nodejs.org/dist/$NODE_LINE"
    work_dir="$(mktemp -d)"

    say "Looking up the current Node.js release..."
    sums="$(curl -fsSL "$base_url/SHASUMS256.txt")"
    line="$(printf '%s\n' "$sums" | grep "linux-$arch.tar.gz\$" | head -n 1)"

    if [ -z "$line" ]; then
        rm -rf "$work_dir"
        fail "Could not find a Node.js build for linux-$arch."
    fi

    checksum="${line%% *}"
    file_name="${line##* }"

    say "Downloading $file_name..."
    curl -fsSL "$base_url/$file_name" -o "$work_dir/$file_name"

    if ! printf '%s  %s\n' "$checksum" "$work_dir/$file_name" | sha256sum --check --status; then
        rm -rf "$work_dir"
        fail "The downloaded Node.js file does not match its checksum."
    fi

    rm -rf "$INSTALL_DIR/node.new"
    mkdir -p "$INSTALL_DIR/node.new"
    tar -xzf "$work_dir/$file_name" -C "$INSTALL_DIR/node.new" --strip-components=1
    rm -rf "$work_dir"

    rm -rf "$INSTALL_DIR/node"
    mv "$INSTALL_DIR/node.new" "$INSTALL_DIR/node"
}

download_app() {
    local url work_dir

    url="https://github.com/$REPOSITORY/archive/refs/heads/$REF.tar.gz"
    work_dir="$(mktemp -d)"

    say "Downloading lnxeasy ($REF)..."
    if ! curl -fsSL "$url" -o "$work_dir/app.tar.gz"; then
        rm -rf "$work_dir"
        fail "Could not download $url"
    fi

    rm -rf "$INSTALL_DIR/app.new"
    mkdir -p "$INSTALL_DIR/app.new"
    tar -xzf "$work_dir/app.tar.gz" -C "$INSTALL_DIR/app.new" --strip-components=1
    rm -rf "$work_dir"

    if [ ! -f "$INSTALL_DIR/app.new/server.js" ] || [ ! -d "$INSTALL_DIR/app.new/public" ]; then
        rm -rf "$INSTALL_DIR/app.new"
        fail "The downloaded archive does not look like lnxeasy."
    fi

    rm -rf "$INSTALL_DIR/app"
    mv "$INSTALL_DIR/app.new" "$INSTALL_DIR/app"
}

create_user() {
    if id "$SERVICE_USER" >/dev/null 2>&1; then
        return
    fi

    say "Creating the \"$SERVICE_USER\" system user..."
    useradd --system --no-create-home --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
}

write_config() {
    if [ -f "$CONFIG_FILE" ]; then
        say "Keeping the existing configuration in $CONFIG_FILE"
        return
    fi

    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<EOF
HOST=127.0.0.1
PORT=$DEFAULT_PORT
EOF
    chmod 644 "$CONFIG_FILE"
}

write_unit() {
    cat > "$UNIT_FILE" <<EOF
[Unit]
Description=lnxeasy server panel
Documentation=https://github.com/$REPOSITORY
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/app
EnvironmentFile=$CONFIG_FILE
Environment=NODE_ENV=production
ExecStart=$INSTALL_DIR/node/bin/node $INSTALL_DIR/app/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
}

start_service() {
    systemctl daemon-reload
    systemctl enable lnxeasy.service >/dev/null 2>&1
    systemctl restart lnxeasy.service
}

read_config_value() {
    local name="$1" fallback="$2" value

    value="$(grep "^$name=" "$CONFIG_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
    if [ -z "$value" ]; then
        value="$fallback"
    fi
    say "$value"
}

wait_until_ready() {
    local host="$1" port="$2" attempt

    for attempt in 1 2 3 4 5 6 7 8 9 10; do
        if curl -fsS -o /dev/null "http://$host:$port/api/health" 2>/dev/null; then
            return 0
        fi
        sleep 1
    done

    return 1
}

print_summary() {
    local host port server_address

    host="$(read_config_value HOST 127.0.0.1)"
    port="$(read_config_value PORT "$DEFAULT_PORT")"
    server_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$server_address" ]; then
        server_address="SERVER_ADDRESS"
    fi

    if ! wait_until_ready "$host" "$port"; then
        say ""
        say "lnxeasy was installed, but it did not answer on http://$host:$port"
        say "Look at the log:  journalctl -u lnxeasy -n 50"
        exit 1
    fi

    say ""
    say "lnxeasy is running on http://$host:$port"
    say ""
    say "It listens on this machine only, because it has no login yet."
    say "To open it from your computer, run this there:"
    say ""
    say "    ssh -L $port:127.0.0.1:$port YOUR_USER@$server_address"
    say ""
    say "and then open http://127.0.0.1:$port in the browser."
    say ""
    say "Status:     systemctl status lnxeasy"
    say "Log:        journalctl -u lnxeasy -f"
    say "Settings:   $CONFIG_FILE (then: systemctl restart lnxeasy)"
    say "Update:     run this installer again"
    say "Uninstall:  run this installer with --uninstall"
}

install() {
    require_root
    check_system
    check_systemd

    mkdir -p "$INSTALL_DIR"
    download_node
    download_app
    create_user
    write_config
    write_unit
    start_service
    print_summary
}

uninstall() {
    require_root

    if command -v systemctl >/dev/null 2>&1; then
        systemctl disable --now lnxeasy.service >/dev/null 2>&1 || true
    fi

    rm -f "$UNIT_FILE"
    rm -rf "$INSTALL_DIR" "$CONFIG_DIR"

    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload || true
    fi

    if id "$SERVICE_USER" >/dev/null 2>&1; then
        userdel "$SERVICE_USER" >/dev/null 2>&1 || true
    fi

    say "lnxeasy was removed."
}

check_install_dir() {
    case "$INSTALL_DIR" in
        /*/*) ;;
        *) fail "Refusing to use \"$INSTALL_DIR\" as the install directory." ;;
    esac
}

main() {
    check_install_dir

    case "${1:-}" in
        "") install ;;
        --uninstall) uninstall ;;
        *) fail "Unknown option: $1. Use no option to install or update, or --uninstall to remove." ;;
    esac
}

if [ "${LNXEASY_SOURCE_ONLY:-}" != "1" ]; then
    main "$@"
fi
