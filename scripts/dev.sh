#!/usr/bin/env bash
# dev.sh — avvia (o riavvia) server e client Pulsar in modalità dev, senza Docker.
#
# Uso:
#   ./dev.sh            avvia server (:3021) e client (:5173)
#   ./dev.sh --install  esegue "npm install" in server/ e client/ prima di avviare
#
# Entrambi girano nello stesso terminale; Ctrl+C ferma tutto.
# Prima di avviare, libera le porte se già occupate (riavvio pulito).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/server"
CLIENT_DIR="$ROOT/client"

stop_port() {
    # Chiude qualsiasi processo in ascolto sulla porta (riavvio pulito).
    local port="$1" pids=""
    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    elif command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "$port"/tcp 2>/dev/null || true)"
    fi
    if [ -n "$pids" ]; then
        echo "Porta $port liberata (PID $pids)"
        kill -9 $pids 2>/dev/null || true
    fi
}

if [ "${1:-}" = "--install" ]; then
    echo "npm install nel server..."
    (cd "$SERVER_DIR" && npm install)
    echo "npm install nel client..."
    (cd "$CLIENT_DIR" && npm install)
fi

echo "Riavvio: libero le porte 3021 e 5173..."
stop_port 3021
stop_port 5173

# Alla chiusura (Ctrl+C) ferma entrambi i processi figli.
pids=()
cleanup() {
    echo ""
    echo "Arresto server e client..."
    kill "${pids[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Avvio server (http://localhost:3021)..."
(cd "$SERVER_DIR" && npm run dev) &
pids+=($!)

echo "Avvio client (http://localhost:5173)..."
(cd "$CLIENT_DIR" && npm run dev) &
pids+=($!)

echo ""
echo "Server e client avviati. Ctrl+C per fermare entrambi."
wait
