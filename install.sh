#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="ix1osbek/lnxeasy"
REF="${LNXEASY_REF:-main}"
NODE_LINE="latest-v22.x"

INSTALL_DIR="${LNXEASY_INSTALL_DIR:-/opt/lnxeasy}"
CONFIG_DIR="${LNXEASY_CONFIG_DIR:-/etc/lnxeasy}"
STATE_DIR="${LNXEASY_STATE_DIR:-/var/lib/lnxeasy}"
CONFIG_FILE="$CONFIG_DIR/lnxeasy.env"
TLS_DIR="$CONFIG_DIR/tls"
TLS_CERT_FILE="$TLS_DIR/cert.pem"
TLS_KEY_FILE="$TLS_DIR/key.pem"
AUTH_FILE="$STATE_DIR/auth.json"
UNIT_FILE="/etc/systemd/system/lnxeasy.service"
COMMAND_FILE="/usr/local/bin/lnxeasy"
SERVICE_USER="lnxeasy"
DEFAULT_PORT="4321"
CERTIFICATE_DAYS="825"

NEW_USERNAME=""
NEW_PASSWORD=""

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

check_directory() {
    case "$1" in
        /*/*) ;;
        *) fail "Refusing to use \"$1\" as a directory of lnxeasy." ;;
    esac
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
    require_command openssl
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
    tar -xzf "$work_dir/$file_name" -C "$INSTALL_DIR/node.new" --strip-components=1 --no-same-owner
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
    tar -xzf "$work_dir/app.tar.gz" -C "$INSTALL_DIR/app.new" --strip-components=1 --no-same-owner
    rm -rf "$work_dir"

    if [ ! -f "$INSTALL_DIR/app.new/server.js" ] || [ ! -f "$INSTALL_DIR/app.new/cli.js" ] || [ ! -d "$INSTALL_DIR/app.new/public" ]; then
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

create_state_directory() {
    install -d -m 700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR"
}

ensure_config_value() {
    local name="$1" value="$2"

    if grep -q "^$name=" "$CONFIG_FILE" 2>/dev/null; then
        return
    fi

    printf '%s=%s\n' "$name" "$value" >> "$CONFIG_FILE"
}

write_config() {
    mkdir -p "$CONFIG_DIR"

    if [ -f "$CONFIG_FILE" ]; then
        say "Keeping the existing settings in $CONFIG_FILE"
    else
        : > "$CONFIG_FILE"
    fi

    ensure_config_value HOST "0.0.0.0"
    ensure_config_value PORT "$DEFAULT_PORT"
    ensure_config_value AUTH_FILE "$AUTH_FILE"
    ensure_config_value TLS_CERT_FILE "$TLS_CERT_FILE"
    ensure_config_value TLS_KEY_FILE "$TLS_KEY_FILE"

    chmod 644 "$CONFIG_FILE"
}

read_config_value() {
    local name="$1" fallback="$2" value

    value="$(grep "^$name=" "$CONFIG_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2-)"
    if [ -z "$value" ]; then
        value="$fallback"
    fi
    say "$value"
}

list_subject_names() {
    local names address

    names="DNS:localhost,IP:127.0.0.1"

    if [ -n "$(hostname 2>/dev/null)" ]; then
        names="$names,DNS:$(hostname)"
    fi

    for address in $(hostname -I 2>/dev/null); do
        names="$names,IP:$address"
    done

    say "$names"
}

create_certificate() {
    local cert_file key_file

    cert_file="$(read_config_value TLS_CERT_FILE "$TLS_CERT_FILE")"
    key_file="$(read_config_value TLS_KEY_FILE "$TLS_KEY_FILE")"

    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        return
    fi

    if [ "$cert_file" != "$TLS_CERT_FILE" ] || [ "$key_file" != "$TLS_KEY_FILE" ]; then
        fail "The certificate files named in $CONFIG_FILE do not exist: $cert_file, $key_file"
    fi

    say "Creating a self-signed HTTPS certificate..."
    install -d -m 750 -o root -g "$SERVICE_USER" "$TLS_DIR"

    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
        -keyout "$TLS_KEY_FILE" -out "$TLS_CERT_FILE" -days "$CERTIFICATE_DAYS" \
        -subj "/CN=lnxeasy" -addext "subjectAltName=$(list_subject_names)" >/dev/null 2>&1 \
        || fail "Could not create the HTTPS certificate with openssl."

    chown root:"$SERVICE_USER" "$TLS_KEY_FILE" "$TLS_CERT_FILE"
    chmod 640 "$TLS_KEY_FILE"
    chmod 644 "$TLS_CERT_FILE"
}

write_command() {
    cat > "$COMMAND_FILE" <<EOF
#!/bin/sh
set -a
. "$CONFIG_FILE"
set +a
exec "$INSTALL_DIR/node/bin/node" "$INSTALL_DIR/app/cli.js" "\$@"
EOF
    chmod 755 "$COMMAND_FILE"
}

create_account() {
    local auth_file output

    auth_file="$(read_config_value AUTH_FILE "$AUTH_FILE")"
    if [ -f "$auth_file" ]; then
        return
    fi

    say "Creating the admin account..."
    output="$("$COMMAND_FILE" passwd --generate)" || fail "Could not create the admin account."

    NEW_USERNAME="$(printf '%s\n' "$output" | sed -n 's/^Username: //p')"
    NEW_PASSWORD="$(printf '%s\n' "$output" | sed -n 's/^Password: //p')"

    if [ -z "$NEW_PASSWORD" ]; then
        fail "Could not create the admin account."
    fi
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
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF
}

start_service() {
    systemctl daemon-reload
    systemctl enable lnxeasy.service >/dev/null 2>&1
    systemctl restart lnxeasy.service
}

wait_until_ready() {
    local port="$1" attempt

    for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if curl -fsSk -o /dev/null "https://127.0.0.1:$port/api/health" 2>/dev/null; then
            return 0
        fi
        sleep 1
    done

    return 1
}

print_summary() {
    local host port address

    host="$(read_config_value HOST 0.0.0.0)"
    port="$(read_config_value PORT "$DEFAULT_PORT")"
    address="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$address" ]; then
        address="SERVER_ADDRESS"
    fi

    if ! wait_until_ready "$port"; then
        say ""
        say "lnxeasy was installed, but it does not answer on port $port."
        say "Look at the log:  journalctl -u lnxeasy -n 50"
        exit 1
    fi

    say ""
    say "lnxeasy is running."
    say ""
    if [ "$host" = "127.0.0.1" ]; then
        say "    Open:      https://127.0.0.1:$port  (this machine only, see HOST in $CONFIG_FILE)"
    else
        say "    Open:      https://$address:$port"
    fi
    if [ -n "$NEW_PASSWORD" ]; then
        say "    Username:  $NEW_USERNAME"
        say "    Password:  $NEW_PASSWORD"
        say ""
        say "Write the password down now. It is not stored anywhere and will not be shown again."
        say "You can change it in the browser, or with: sudo lnxeasy passwd"
    else
        say ""
        say "The admin account was kept. Forgot the password? Run: sudo lnxeasy passwd"
    fi
    say ""
    say "The browser will warn about the certificate once, because it is self-signed."
    say "If the page does not open, allow TCP port $port in the firewall of the server and of your cloud provider."
    say ""
    say "Status:     systemctl status lnxeasy"
    say "Log:        journalctl -u lnxeasy -f"
    say "Settings:   $CONFIG_FILE (then: systemctl restart lnxeasy)"
    say "Update:     run this installer again"
    say "Uninstall:  run this installer with --uninstall"
}

install_lnxeasy() {
    require_root
    check_system
    check_systemd

    mkdir -p "$INSTALL_DIR"
    download_node
    download_app
    create_user
    create_state_directory
    write_config
    create_certificate
    write_command
    create_account
    write_unit
    start_service
    print_summary
}

uninstall_lnxeasy() {
    require_root

    if command -v systemctl >/dev/null 2>&1; then
        systemctl disable --now lnxeasy.service >/dev/null 2>&1 || true
    fi

    rm -f "$UNIT_FILE" "$COMMAND_FILE"
    rm -rf "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"

    if command -v systemctl >/dev/null 2>&1; then
        systemctl daemon-reload || true
    fi

    if id "$SERVICE_USER" >/dev/null 2>&1; then
        userdel "$SERVICE_USER" >/dev/null 2>&1 || true
    fi

    say "lnxeasy was removed."
}

main() {
    check_directory "$INSTALL_DIR"
    check_directory "$CONFIG_DIR"
    check_directory "$STATE_DIR"

    case "${1:-}" in
        "") install_lnxeasy ;;
        --uninstall) uninstall_lnxeasy ;;
        *) fail "Unknown option: $1. Use no option to install or update, or --uninstall to remove." ;;
    esac
}

if [ "${LNXEASY_SOURCE_ONLY:-}" != "1" ]; then
    main "$@"
fi
