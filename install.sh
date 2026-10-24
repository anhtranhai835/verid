#!/bin/sh
# curl -fsSL https://raw.githubusercontent.com/anhtranhai835/verid/main/install.sh | sh

fail() { printf '%s\n' "$*" >&2; exit 1; }
next_step() { printf '%s\n' 'Next: cd <your project folder> && verid cook'; }
plugin_command() {
  if ! claude "$@"; then
    printf 'Plugin setup did not complete; if needed, run: claude %s\n' "$*"
  fi
}

# Parse the complete function before executing a downloaded script.
main() {
  set -eu
  version=${VERID_VERSION:-latest}
  # List ASCII characters explicitly so locale-specific ranges cannot widen the pin.
  case "$version" in
    [.+-]*|*[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.+-]*) fail 'VERID_VERSION must be a version or tag, e.g. 1.1.0 or latest.' ;;
  esac
  if ! command -v node >/dev/null 2>&1 ||
     ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"; then
    fail 'Install Node.js 22 or later from https://nodejs.org, reopen your terminal, and run this installer again.'
  fi
  printf 'Installing @anhtranhai835/verid@%s\n' "$version"
  npm install -g "@anhtranhai835/verid@$version" || fail 'npm install failed. Resolve the npm error and run this installer again.'
  if command -v claude >/dev/null 2>&1; then
    plugin_command plugin marketplace add obra/superpowers-marketplace
    plugin_command plugin install superpowers@superpowers-marketplace
    plugin_command plugin marketplace add forrestchang/andrej-karpathy-skills
    plugin_command plugin install andrej-karpathy-skills@karpathy-skills
    plugin_command plugin marketplace add anhtranhai835/verid
    plugin_command plugin install verid@verid
  else
    printf '%s\n' 'After installing Claude Code, run:' \
      'claude plugin marketplace add obra/superpowers-marketplace' \
      'claude plugin install superpowers@superpowers-marketplace' \
      'claude plugin marketplace add forrestchang/andrej-karpathy-skills' \
      'claude plugin install andrej-karpathy-skills@karpathy-skills' \
      'claude plugin marketplace add anhtranhai835/verid' \
      'claude plugin install verid@verid'
  fi

  case "${CI:-}" in ''|[Ff][Aa][Ll][Ss][Ee]|0) ;; *) next_step; return ;; esac
  # curl | sh reads the script on stdin; questions use the controlling terminal.
  # Probe in a subshell: a failed exec redirection would terminate a POSIX shell.
  if ! ( : </dev/tty >/dev/tty ) 2>/dev/null; then next_step; return; fi
  exec 3</dev/tty 4>/dev/tty
  if ! [ -t 3 ] || ! [ -t 4 ]; then next_step; return; fi
  printf 'Project folder (leave empty to finish): ' >&4
  folder=''
  read -r folder <&3 || folder=''
  case "$folder" in
    '') next_step; return ;;
    \"*\") folder=${folder#\"}; folder=${folder%\"} ;;
    \'*\') folder=${folder#\'}; folder=${folder%\'} ;;
  esac
  if [ -z "${HOME:-}" ] || ! home_folder=$(CDPATH= cd -P "$HOME" 2>/dev/null && pwd -P); then
    printf '%s\n' 'Home folder is unavailable. Set HOME to an existing folder, then run verid cook in your project.' >&4
    next_step
    return
  fi
  # read keeps ~ literal, including after removing a user's surrounding quotes.
  case "$folder" in '~') folder=$HOME ;; '~/'*) folder=${HOME%/}/${folder#'~/'} ;; esac
  [ -d "$folder" ] || fail 'Choose an existing project folder.'
  # Resolve symlinks before .., and keep CDPATH from changing the path or output.
  target=$(CDPATH= cd -P "$folder" && pwd -P) || fail 'Choose an existing project folder.'
  if [ "$target" -ef "$home_folder" ] || [ "$target" = "$home_folder" ]; then
    printf '%s\n' 'Choose a project folder other than your home folder.' >&4
    next_step
    return
  fi
  command -v verid >/dev/null 2>&1 || { printf 'Reopen your terminal. '; next_step; return; }
  (cd "$target" && verid cook <&3 >&4 2>&4) || fail 'verid cook failed. Resolve its message and run verid cook again in the project.'
}

main "$@"
