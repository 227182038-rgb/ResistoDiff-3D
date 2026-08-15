#!/usr/bin/env bash
#
# ResistoDiff-3D — One-Click Setup & Run Script
# ==============================================
# Usage:
#   ./setup.sh              # Full setup + option to start servers
#   ./setup.sh --start      # Start both servers
#   ./setup.sh --stop       # Kill both servers
#   ./setup.sh --status     # Check if servers are running
#   ./setup.sh --update     # Re-download PDB structures
#

set -euo pipefail

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────
PROJECT_DIR="/home/z/my-project"
PYTHON_BACKEND_DIR="${PROJECT_DIR}/python-backend"
VENV_DIR="${PYTHON_BACKEND_DIR}/.venv"
REQUIREMENTS="${PYTHON_BACKEND_DIR}/requirements.txt"
DATA_DIR="${PYTHON_BACKEND_DIR}/data/bio_targets"
PID_FILE="${PROJECT_DIR}/.resistodiff.pids"
ENV_FILE="${PYTHON_BACKEND_DIR}/.env"

# PDB targets: target_name|pdb_id|subdir
PDB_TARGETS=(
  "TEM-1|1ZG4|tem1"
  "KPC-2|3DXG|kpc2"
  "NDM-1|3SPU|ndm1"
  "DNA-Gyrase-A|1KZN|gyrase_a"
)

# ──────────────────────────────────────────────
# Color helpers
# ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}❯${NC} $*"; }
success() { echo -e "${GREEN}✓${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }
header()  { echo -e "\n${BOLD}${CYAN}━━━ $* ━━━${NC}\n"; }

# ──────────────────────────────────────────────
# Phase 1 — Check system dependencies
# ──────────────────────────────────────────────
check_system_deps() {
  header "Phase 1: Checking System Dependencies"

  local missing=()

  if command -v bun &>/dev/null; then
    success "bun found: $(bun --version)"
  else
    missing+=("bun")
    error "bun NOT found — install from https://bun.sh"
  fi

  if command -v python3 &>/dev/null; then
    success "python3 found: $(python3 --version 2>&1)"
  else
    missing+=("python3")
    error "python3 NOT found — install via your package manager (apt, brew, etc.)"
  fi

  if command -v pip3 &>/dev/null; then
    success "pip3 found: $(pip3 --version 2>&1)"
  else
    missing+=("pip3")
    error "pip3 NOT found — install via your package manager"
  fi

  if command -v wget &>/dev/null; then
    success "wget found: $(wget --version 2>&1 | head -1)"
  elif command -v curl &>/dev/null; then
    success "curl found: $(curl --version 2>&1 | head -1)"
  else
    missing+=("wget/curl")
    error "Neither wget nor curl found — one is required to download PDB files"
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    error "Missing required tools: ${missing[*]}"
    error "Please install them and re-run this script."
    exit 1
  fi

  success "All system dependencies satisfied."
}

# ──────────────────────────────────────────────
# Phase 2 — Create Python virtual environment
# ──────────────────────────────────────────────
setup_python_venv() {
  header "Phase 2: Python Virtual Environment"

  if [[ -d "${VENV_DIR}" ]]; then
    warn "Virtual environment already exists at ${VENV_DIR}"
    info "Removing old venv and recreating..."
    rm -rf "${VENV_DIR}"
  fi

  info "Creating venv at ${VENV_DIR} ..."
  if python3 -m venv "${VENV_DIR}" 2>&1; then
    success "Virtual environment created."
  else
    error "Failed to create virtual environment."
    exit 1
  fi

  info "Upgrading pip inside venv..."
  "${VENV_DIR}/bin/pip" install --upgrade pip --quiet 2>&1
  success "Pip upgraded."
}

# ──────────────────────────────────────────────
# Phase 3 — Install Python dependencies
# ──────────────────────────────────────────────
install_python_deps() {
  header "Phase 3: Installing Python Dependencies"

  if [[ ! -f "${REQUIREMENTS}" ]]; then
    error "requirements.txt not found at ${REQUIREMENTS}"
    exit 1
  fi

  info "Installing from ${REQUIREMENTS} ..."
  if "${VENV_DIR}/bin/pip" install -r "${REQUIREMENTS}" 2>&1; then
    success "Python dependencies installed."
  else
    error "Failed to install Python dependencies."
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Phase 4 — Install Node/Bun dependencies
# ──────────────────────────────────────────────
install_bun_deps() {
  header "Phase 4: Installing Frontend Dependencies (bun)"

  if [[ ! -f "${PROJECT_DIR}/package.json" ]]; then
    error "package.json not found at ${PROJECT_DIR}"
    exit 1
  fi

  info "Running 'bun install' in ${PROJECT_DIR} ..."
  if (cd "${PROJECT_DIR}" && bun install 2>&1); then
    success "Frontend dependencies installed."
  else
    error "Failed to install frontend dependencies."
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Phase 5 — Prisma setup
# ──────────────────────────────────────────────
setup_prisma() {
  header "Phase 5: Prisma Setup"

  if [[ ! -f "${PROJECT_DIR}/prisma/schema.prisma" ]]; then
    warn "No prisma/schema.prisma found — skipping Prisma setup."
    return 0
  fi

  info "Running 'bunx prisma generate' ..."
  if (cd "${PROJECT_DIR}" && bunx prisma generate 2>&1); then
    success "Prisma client generated."
  else
    error "Failed to generate Prisma client."
    exit 1
  fi

  info "Running 'bunx prisma db push' ..."
  if (cd "${PROJECT_DIR}" && bunx prisma db push 2>&1); then
    success "Database schema pushed."
  else
    error "Failed to push database schema."
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Phase 6 — Download PDB files
# ──────────────────────────────────────────────
download_pdb_files() {
  header "Phase 6: Downloading Bio-Target PDB Files"

  local downloader=""
  if command -v wget &>/dev/null; then
    downloader="wget -q -O"
  elif command -v curl &>/dev/null; then
    downloader="curl -sL -o"
  else
    error "No download tool available."
    exit 1
  fi

  local total=${#PDB_TARGETS[@]}
  local count=0

  for entry in "${PDB_TARGETS[@]}"; do
    IFS='|' read -r name pdb_id subdir <<< "${entry}"
    count=$((count + 1))

    local target_dir="${DATA_DIR}/${subdir}"
    local target_file="${target_dir}/${pdb_id}.pdb"
    local url="https://files.rcsb.org/download/${pdb_id}.pdb"

    mkdir -p "${target_dir}"

    # Skip if already downloaded (unless --update)
    if [[ -f "${target_file}" && "${UPDATE_MODE:-0}" == "0" ]]; then
      warn "[${count}/${total}] ${name} (${pdb_id}) already exists — skipping."
      continue
    fi

    info "[${count}/${total}] Downloading ${name} (${pdb_id}) ..."
    if eval "${downloader} \"${target_file}\" \"${url}\"" 2>&1; then
      # Verify file is not empty / not an HTML error page
      if [[ -s "${target_file}" && ! "$(head -c 5 "${target_file}")" == "<html" ]]; then
        success "[${count}/${total}] ${name} → ${target_file}"
      else
        error "[${count}/${total}] Downloaded file for ${name} appears corrupt or empty. Retrying..."
        rm -f "${target_file}"
        if eval "${downloader} \"${target_file}\" \"${url}\"" 2>&1; then
          if [[ -s "${target_file}" ]]; then
            success "[${count}/${total}] ${name} → ${target_file} (retry OK)"
          else
            error "[${count}/${total}] Retry failed for ${name}."
            rm -f "${target_file}"
          fi
        fi
      fi
    else
      error "[${count}/${total}] Failed to download ${name}."
    fi
  done

  success "PDB download phase complete."
}

# ──────────────────────────────────────────────
# Phase 7 — Create .env file
# ──────────────────────────────────────────────
create_env_file() {
  header "Phase 7: Environment Configuration"

  if [[ -f "${ENV_FILE}" ]]; then
    warn ".env already exists at ${ENV_FILE} — preserving."
    return 0
  fi

  cat > "${ENV_FILE}" << 'ENVEOF'
RESISTODIFF_BACKEND_PORT=8000
RESISTODIFF_FRONTEND_URL=http://localhost:3000
RESISTODIFF_DATASET_DIR=/home/z/my-project/python-backend/data/bio_targets
RESISTODIFF_LOG_LEVEL=INFO
ENVEOF

  if [[ -f "${ENV_FILE}" ]]; then
    success ".env created at ${ENV_FILE}"
  else
    error "Failed to create .env file."
    exit 1
  fi
}

# ──────────────────────────────────────────────
# Create necessary directories
# ──────────────────────────────────────────────
create_directories() {
  header "Creating Project Directories"

  local dirs=(
    "${DATA_DIR}/tem1"
    "${DATA_DIR}/kpc2"
    "${DATA_DIR}/ndm1"
    "${DATA_DIR}/gyrase_a"
    "${PROJECT_DIR}/mini-services/resistodiff-engine"
  )

  for d in "${dirs[@]}"; do
    if mkdir -p "${d}" 2>/dev/null; then
      success "Ensured directory: ${d}"
    else
      error "Could not create directory: ${d}"
    fi
  done
}

# ──────────────────────────────────────────────
# Server management
# ──────────────────────────────────────────────

# Read saved PIDs
read_pids() {
  BACKEND_PID=""
  FRONTEND_PID=""
  if [[ -f "${PID_FILE}" ]]; then
    BACKEND_PID=$(sed -n '1p' "${PID_FILE}")
    FRONTEND_PID=$(sed -n '2p' "${PID_FILE}")
  fi
}

is_pid_running() {
  local pid="$1"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi
  return 1
}

start_servers() {
  header "Starting ResistoDiff-3D Servers"

  read_pids

  if is_pid_running "${BACKEND_PID}" || is_pid_running "${FRONTEND_PID}"; then
    warn "Servers may already be running. Use --status to check, --stop to kill."
    # Don't exit — allow user to proceed
  fi

  # Start Python backend
  info "Starting Python backend on http://0.0.0.0:8000 ..."
  cd "${PYTHON_BACKEND_DIR}"
  "${VENV_DIR}/bin/python" -m uvicorn main:app --host 0.0.0.0 --port 8000 &
  BACKEND_PID=$!
  echo "${BACKEND_PID}" > "${PID_FILE}"

  # Give backend a moment to bind
  sleep 2

  if is_pid_running "${BACKEND_PID}"; then
    success "Backend started (PID ${BACKEND_PID})"
  else
    error "Backend failed to start! Check logs above."
    rm -f "${PID_FILE}"
    exit 1
  fi

  # Start Next.js frontend
  info "Starting Next.js frontend on http://localhost:3000 ..."
  cd "${PROJECT_DIR}"
  bun run dev &
  FRONTEND_PID=$!
  echo "${BACKEND_PID}" > "${PID_FILE}"
  echo "${FRONTEND_PID}" >> "${PID_FILE}"

  sleep 3

  if is_pid_running "${FRONTEND_PID}"; then
    success "Frontend started (PID ${FRONTEND_PID})"
  else
    error "Frontend failed to start! Check logs above."
    exit 1
  fi

  echo ""
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  ResistoDiff-3D is running!${NC}"
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
  echo -e ""
  echo -e "  ${CYAN}Frontend:${NC}  http://localhost:3000"
  echo -e "  ${CYAN}Backend:${NC}   http://localhost:8000"
  echo -e "  ${CYAN}API Docs:${NC}  http://localhost:8000/docs"
  echo -e ""
  echo -e "  Open your browser to ${BOLD}http://localhost:3000${NC}"
  echo -e ""
  echo -e "  To stop:  ${YELLOW}./setup.sh --stop${NC}"
  echo -e "  To check: ${YELLOW}./setup.sh --status${NC}"
  echo ""
}

stop_servers() {
  header "Stopping ResistoDiff-3D Servers"

  if [[ ! -f "${PID_FILE}" ]]; then
    warn "No PID file found (${PID_FILE}). Servers may not be running."
    warn "Attempting to find and kill processes by port..."

    # Try killing by port as fallback
    for port in 8000 3000; do
      local pid
      pid=$(lsof -ti :"${port}" 2>/dev/null || true)
      if [[ -n "${pid}" ]]; then
        info "Killing process on port ${port} (PID ${pid})..."
        kill "${pid}" 2>/dev/null || true
      fi
    done

    success "Cleanup done."
    return 0
  fi

  read_pids

  if is_pid_running "${BACKEND_PID}"; then
    info "Stopping backend (PID ${BACKEND_PID})..."
    kill "${BACKEND_PID}" 2>/dev/null
    success "Backend stopped."
  else
    warn "Backend (PID ${BACKEND_PID}) is not running."
  fi

  if is_pid_running "${FRONTEND_PID}"; then
    info "Stopping frontend (PID ${FRONTEND_PID})..."
    kill "${FRONTEND_PID}" 2>/dev/null
    success "Frontend stopped."
  else
    warn "Frontend (PID ${FRONTEND_PID}) is not running."
  fi

  rm -f "${PID_FILE}"
  success "Servers stopped and PID file cleaned up."
}

status_servers() {
  header "ResistoDiff-3D Server Status"

  read_pids

  local backend_up=0
  local frontend_up=0

  if is_pid_running "${BACKEND_PID}"; then
    echo -e "  Backend  (PID ${BACKEND_PID}):  ${GREEN}● RUNNING${NC}  — http://localhost:8000"
    backend_up=1
  else
    echo -e "  Backend  (PID ${BACKEND_PID:-N/A}):  ${RED}○ STOPPED${NC}"
  fi

  if is_pid_running "${FRONTEND_PID}"; then
    echo -e "  Frontend (PID ${FRONTEND_PID}): ${GREEN}● RUNNING${NC}  — http://localhost:3000"
    frontend_up=1
  else
    echo -e "  Frontend (PID ${FRONTEND_PID:-N/A}): ${RED}○ STOPPED${NC}"
  fi

  echo ""

  if [[ ${backend_up} -eq 1 && ${frontend_up} -eq 1 ]]; then
    echo -e "  ${GREEN}${BOLD}All systems operational.${NC}"
  elif [[ ${backend_up} -eq 0 && ${frontend_up} -eq 0 ]]; then
    echo -e "  ${RED}${BOLD}All systems stopped.${NC}"
    echo -e "  Run ${YELLOW}./setup.sh --start${NC} to launch."
  else
    echo -e "  ${YELLOW}${BOLD}Partial — some services are down.${NC}"
    echo -e "  Run ${YELLOW}./setup.sh --stop${NC} then ${YELLOW}./setup.sh --start${NC} to restart."
  fi

  echo ""
}

# ──────────────────────────────────────────────
# Update PDB files only
# ──────────────────────────────────────────────
update_pdbs() {
  header "Updating PDB Structures"
  UPDATE_MODE=1 download_pdb_files
}

# ──────────────────────────────────────────────
# Full setup (all phases)
# ──────────────────────────────────────────────
full_setup() {
  echo -e "${BOLD}${CYAN}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║     ResistoDiff-3D — Setup Wizard         ║"
  echo "  ║     One-Click Configuration               ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo -e "${NC}"

  create_directories
  check_system_deps
  setup_python_venv
  install_python_deps
  install_bun_deps
  setup_prisma
  download_pdb_files
  create_env_file

  echo -e "\n${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
  echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}\n"

  # Ask to start servers
  echo -e "  Would you like to start the servers now?${NC}"
  echo -e "  ${YELLOW}[Y/n]${NC} "
  read -r -t 15 response || response="y"
  case "${response}" in
    [nN]|[nN][oO])
      echo -e "\n  Run ${YELLOW}./setup.sh --start${NC} when you're ready."
      echo -e "  Run ${YELLOW}./setup.sh --status${NC} to check server status.\n"
      ;;
    *)
      start_servers
      ;;
  esac
}

# ──────────────────────────────────────────────
# Usage
# ──────────────────────────────────────────────
usage() {
  echo -e "${BOLD}ResistoDiff-3D Setup Script${NC}"
  echo ""
  echo "Usage:"
  echo "  ./setup.sh              Run full setup (install deps, download data, start servers)"
  echo "  ./setup.sh --start      Start backend + frontend servers"
  echo "  ./setup.sh --stop       Stop both servers"
  echo "  ./setup.sh --status     Show server running status"
  echo "  ./setup.sh --update     Re-download all PDB structure files"
  echo "  ./setup.sh --help       Show this help message"
  echo ""
}

# ──────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────
case "${1:-}" in
  --start)
    start_servers
    ;;
  --stop)
    stop_servers
    ;;
  --status)
    status_servers
    ;;
  --update)
    update_pdbs
    ;;
  --help|-h)
    usage
    ;;
  "")
    full_setup
    ;;
  *)
    error "Unknown argument: $1"
    usage
    exit 1
    ;;
esac
