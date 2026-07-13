#!/usr/bin/env bash
# dev.sh — startet (oder startet neu) Server und Client von Pulsar im Dev-Modus, ohne Docker.
#
# Verwendung:
#   ./dev.sh            startet Server (:3021) und Client (:5173)
#   ./dev.sh --install  führt vor dem Start "npm install" in server/ und client/ aus
#   ./dev.sh --nousers  blendet im Client die "Online users"-Buttons aus
#   Flags sind kombinierbar, z. B. ./dev.sh --install --nousers
#
# Beide laufen im selben Terminal; Ctrl+C stoppt alles.
# Vor dem Start werden die Ports freigegeben, falls sie belegt sind (sauberer Neustart).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
CLIENT_DIR="$ROOT/client"

stop_port() {
    # Beendet jeden Prozess, der auf dem Port lauscht (sauberer Neustart).
    local port="$1" pids=""
    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    elif command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "$port"/tcp 2>/dev/null || true)"
    fi
    if [ -n "$pids" ]; then
        echo "Port $port freigegeben (PID $pids)"
        kill -9 $pids 2>/dev/null || true
    fi
}

# Flags einlesen (in beliebiger Reihenfolge kombinierbar).
do_install=false
client_dev_args=()
for arg in "$@"; do
    case "$arg" in
        --install) do_install=true ;;
        --nousers) client_dev_args+=(--nousers) ;;  # an "npm run dev" durchreichen
        *) echo "Unbekanntes Flag: $arg" >&2; exit 1 ;;
    esac
done

if [ "$do_install" = true ]; then
    echo "npm install im Server..."
    (cd "$SERVER_DIR" && npm install)
    echo "npm install im Client..."
    (cd "$CLIENT_DIR" && npm install)
fi

echo "Neustart: gebe die Ports 3021 und 5173 frei..."
stop_port 3021
stop_port 5173

# Beim Beenden (Ctrl+C) beide Kindprozesse stoppen.
pids=()
cleanup() {
    echo ""
    echo "Stoppe Server und Client..."
    kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starte Server (http://localhost:3021)..."
(cd "$SERVER_DIR" && npm run dev) &
pids+=($!)

echo "Starte Client (http://localhost:5173)..."
(cd "$CLIENT_DIR" && npm run dev ${client_dev_args[@]+"${client_dev_args[@]}"}) &
pids+=($!)

echo ""
echo "Server und Client gestartet. Ctrl+C zum Stoppen beider."
wait
