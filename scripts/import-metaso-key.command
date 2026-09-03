#!/bin/zsh

set -eu

readonly KEY_NAME="METASO_API_KEY"
readonly KEYCHAIN_SERVICE="cc.jasonstu.metaso-search-neo.api-key"
readonly LEGACY_KEYCHAIN_SERVICE="com.jasonstudio.metaso-search-neo.api-key"
readonly SECURITY_BIN="${METASO_SECURITY_BIN:-/usr/bin/security}"
readonly LAUNCHCTL_BIN="${METASO_LAUNCHCTL_BIN:-/bin/launchctl}"
readonly PROFILE_DIR_INPUT="${METASO_KEY_PROFILE_DIR:-${CODEX_HOME:-${HOME}/.codex}/state/metaso-search-neo/key-profiles}"
if [[ "$PROFILE_DIR_INPUT" != /* ]]; then
  print -u2 "METASO_KEY_PROFILE_DIR and CODEX_HOME must resolve to an absolute path."
  exit 2
fi
readonly PROFILE_DIR="$PROFILE_DIR_INPUT"
readonly ACTIVE_PROFILE_FILE="$PROFILE_DIR/active-profile"
readonly PROFILE_REGISTRY_FILE="$PROFILE_DIR/profiles.tsv"

usage() {
  cat <<'EOF'
Usage:
  import-metaso-key.command                  Add a named Key
  import-metaso-key.command --list           List saved names and notes
  import-metaso-key.command --use NAME       Select the Key used at next MCP startup
  import-metaso-key.command --status         Check the selected Key
  import-metaso-key.command --clear [NAME]   Delete one Key, or the selected Key

Keys are stored in macOS Login Keychain. Names, notes, and the selected name are
non-secret metadata stored under the Codex state directory. MetaSo Search Neo
reads the selected Key directly when its MCP process starts; no Key is injected
into the global launchd GUI environment or written to config.toml/history.
EOF
}

is_valid_key() {
  local candidate="$1"
  (( ${#candidate} >= 19 && ${#candidate} <= 256 )) &&
    [[ "$candidate" =~ '^mk-[A-Za-z0-9]{16,}$' ]]
}

is_valid_profile() {
  local candidate="$1"
  (( ${#candidate} >= 1 && ${#candidate} <= 48 )) &&
    [[ "$candidate" =~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$' ]]
}

is_valid_note() {
  local candidate="$1"
  (( ${#candidate} <= 200 )) &&
    [[ ! "$candidate" =~ '[[:cntrl:]]' ]]
}

prepare_profile_directory() {
  /bin/mkdir -p "$PROFILE_DIR"
  /bin/chmod 700 "$PROFILE_DIR"
}

read_active_profile() {
  local selected=""
  if [[ -f "$ACTIVE_PROFILE_FILE" ]]; then
    IFS= read -r selected < "$ACTIVE_PROFILE_FILE" || true
  fi
  is_valid_profile "$selected" && print -r -- "$selected"
}

write_active_profile() {
  local selected="$1"
  local temporary
  prepare_profile_directory
  temporary="$(/usr/bin/mktemp "$PROFILE_DIR/.active-profile.XXXXXX")"
  /bin/chmod 600 "$temporary"
  print -r -- "$selected" > "$temporary"
  /bin/mv -f "$temporary" "$ACTIVE_PROFILE_FILE"
}

read_key_from_service() {
  local service="$1"
  local profile="$2"
  "$SECURITY_BIN" find-generic-password -a "$profile" -s "$service" -w 2>/dev/null || true
}

read_key() {
  local profile="$1"
  local primary legacy
  primary="$(read_key_from_service "$KEYCHAIN_SERVICE" "$profile")"
  if is_valid_key "$primary"; then
    print -rn -- "$primary"
    return 0
  fi
  legacy="$(read_key_from_service "$LEGACY_KEYCHAIN_SERVICE" "$profile")"
  if is_valid_key "$legacy"; then
    print -rn -- "$legacy"
    return 0
  fi
  [[ -n "$primary" ]] && print -rn -- "$primary" || print -rn -- "$legacy"
}

keychain_item_exists() {
  local service="$1"
  local profile="$2"
  "$SECURITY_BIN" find-generic-password -a "$profile" -s "$service" >/dev/null 2>&1
}

clear_profile_credentials() {
  local profile="$1"
  local service found failed
  found=0
  failed=0
  for service in "$KEYCHAIN_SERVICE" "$LEGACY_KEYCHAIN_SERVICE"; do
    if keychain_item_exists "$service" "$profile"; then
      found=1
      if ! "$SECURITY_BIN" delete-generic-password -a "$profile" -s "$service" >/dev/null 2>&1; then
        failed=1
      fi
    fi
  done
  (( failed == 0 )) || return 1
  (( found == 1 )) && return 0
  return 2
}

register_profile() {
  local profile="$1"
  local note="$2"
  local temporary existing existing_note
  prepare_profile_directory
  temporary="$(/usr/bin/mktemp "$PROFILE_DIR/.profiles.XXXXXX")"
  /bin/chmod 600 "$temporary"
  if [[ -f "$PROFILE_REGISTRY_FILE" ]]; then
    while IFS=$'\t' read -r existing existing_note; do
      [[ -z "$existing" || "$existing" == "$profile" ]] && continue
      print -r -- "$existing"$'\t'"$existing_note" >> "$temporary"
    done < "$PROFILE_REGISTRY_FILE"
  fi
  print -r -- "$profile"$'\t'"$note" >> "$temporary"
  /bin/mv -f "$temporary" "$PROFILE_REGISTRY_FILE"
}

unregister_profile() {
  local profile="$1"
  local temporary existing existing_note
  [[ -f "$PROFILE_REGISTRY_FILE" ]] || return 0
  temporary="$(/usr/bin/mktemp "$PROFILE_DIR/.profiles.XXXXXX")"
  /bin/chmod 600 "$temporary"
  while IFS=$'\t' read -r existing existing_note; do
    [[ -z "$existing" || "$existing" == "$profile" ]] && continue
    print -r -- "$existing"$'\t'"$existing_note" >> "$temporary"
  done < "$PROFILE_REGISTRY_FILE"
  /bin/mv -f "$temporary" "$PROFILE_REGISTRY_FILE"
}

clear_sensitive_values() {
  unset api_key stored_key 2>/dev/null || true
}

trap clear_sensitive_values EXIT HUP INT TERM

case "${1:-}" in
  "")
    ;;
  --list)
    active_profile="$(read_active_profile || true)"
    if [[ ! -s "$PROFILE_REGISTRY_FILE" ]]; then
      print "No named MetaSo API Keys are registered."
      exit 0
    fi
    while IFS=$'\t' read -r profile_name profile_note; do
      is_valid_profile "$profile_name" || continue
      is_valid_note "$profile_note" || profile_note="[invalid note omitted]"
      marker=" "
      [[ "$profile_name" == "$active_profile" ]] && marker="*"
      if is_valid_key "$(read_key "$profile_name")"; then
        print -r -- "$marker $profile_name${profile_note:+ — $profile_note}"
      else
        print -r -- "! $profile_name${profile_note:+ — $profile_note} (missing or invalid Keychain item)"
      fi
    done < "$PROFILE_REGISTRY_FILE"
    exit 0
    ;;
  --use)
    profile_name="${2:-}"
    if ! is_valid_profile "$profile_name"; then
      print -u2 "Invalid Key name. Use 1-48 ASCII letters, digits, dots, underscores, or hyphens; start with a letter or digit."
      exit 2
    fi
    stored_key="$(read_key "$profile_name")"
    if ! is_valid_key "$stored_key"; then
      print -u2 "No valid MetaSo API Key is stored under that name."
      exit 1
    fi
    write_active_profile "$profile_name"
    print -r -- "Selected '$profile_name'. Fully restart Codex before testing."
    exit 0
    ;;
  --status)
    active_profile="$(read_active_profile || true)"
    if [[ -z "$active_profile" ]]; then
      print -u2 "No MetaSo API Key is selected."
      exit 1
    fi
    stored_key="$(read_key "$active_profile")"
    if is_valid_key "$stored_key"; then
      print -r -- "Selected '$active_profile'; its Keychain item has a valid-looking MetaSo API Key."
      exit 0
    fi
    print -u2 "Selected '$active_profile', but its Keychain item is missing or invalid."
    exit 1
    ;;
  --clear)
    profile_name="${2:-$(read_active_profile || true)}"
    if ! is_valid_profile "$profile_name"; then
      print -u2 "Specify a valid Key name, or select one before using --clear."
      exit 2
    fi
    deletion_message=""
    if clear_profile_credentials "$profile_name"; then
      deletion_message="Deleted '$profile_name' from macOS Login Keychain."
    else
      deletion_status=$?
      if (( deletion_status == 1 )); then
        print -u2 "Could not delete every Keychain item for '$profile_name'; selection metadata was retained."
        exit 1
      fi
      deletion_message="No Keychain item existed for '$profile_name'; removed stale selection metadata."
    fi
    unregister_profile "$profile_name"
    if [[ "$(read_active_profile || true)" == "$profile_name" ]]; then
      /bin/rm -f "$ACTIVE_PROFILE_FILE"
    fi
    "$LAUNCHCTL_BIN" unsetenv "$KEY_NAME" >/dev/null 2>&1 || true
    print -r -- "$deletion_message"
    print "Cleared the legacy launchd session value."
    exit 0
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    print -u2 "Unknown option: $1"
    usage >&2
    exit 2
    ;;
esac

if [[ -t 0 ]]; then
  read -r "profile_name?API Key name [default]: "
  profile_name="${profile_name:-default}"
  read -r "profile_note?Note (optional, shown by --list): "
else
  IFS= read -r profile_name
  profile_name="${profile_name:-default}"
  IFS= read -r profile_note
fi

if ! is_valid_profile "$profile_name"; then
  print -u2 "Invalid Key name. Use 1-48 ASCII letters, digits, dots, underscores, or hyphens; start with a letter or digit."
  exit 2
fi
if ! is_valid_note "$profile_note"; then
  print -u2 "Invalid note. Use one line of at most 200 characters without control characters."
  exit 2
fi
stored_key="$(read_key "$profile_name")"
if is_valid_key "$stored_key"; then
  print -u2 "A valid Key already exists under '$profile_name'. To avoid destructive overwrites, import under a new name, switch with --use, then clear the old profile."
  exit 1
fi
print "Enter the MetaSo API Key twice at the macOS Keychain prompts. Input is hidden."
if ! "$SECURITY_BIN" add-generic-password \
  -U \
  -a "$profile_name" \
  -s "$KEYCHAIN_SERVICE" \
  -l "MetaSo Search Neo: $profile_name" \
  -j "$profile_note" \
  -T /usr/bin/security \
  -w >/dev/null; then
  print -u2 "Could not save the MetaSo API Key in macOS Login Keychain."
  exit 1
fi

stored_key="$(read_key "$profile_name")"
if ! is_valid_key "$stored_key"; then
  if clear_profile_credentials "$profile_name"; then
    print -u2 "Invalid MetaSo API Key format. The new Keychain item was deleted; expected mk- followed by at least 16 ASCII letters or digits, with no spaces."
    exit 2
  fi
  cleanup_status=$?
  if (( cleanup_status == 2 )); then
    print -u2 "Invalid MetaSo API Key format, and no new Keychain item was found to delete."
  else
    print -u2 "Invalid MetaSo API Key format, and the new Keychain item could not be deleted. Remove it manually before retrying."
  fi
  exit 1
fi

register_profile "$profile_name" "$profile_note"
write_active_profile "$profile_name"
if ! "$LAUNCHCTL_BIN" unsetenv "$KEY_NAME" >/dev/null 2>&1; then
  print -u2 "Warning: the legacy launchd session value could not be cleared."
fi

print -r -- "Saved and selected '$profile_name' in macOS Login Keychain."
print "Any legacy launchd session value was cleared."
print "Fully quit Codex with Command-Q, reopen it, and create a new task before testing MetaSo Search Neo."
