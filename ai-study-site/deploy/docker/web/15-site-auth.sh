#!/bin/sh
set -eu
if [ "${SITE_AUTH_MODE:-off}" != "off" ]; then
    umask 077
    if [ -n "${SITE_HTPASSWD_FILE:-}" ]; then
        cp "$SITE_HTPASSWD_FILE" /tmp/orot.htpasswd
    elif [ -n "${SITE_HTPASSWD:-}" ]; then
        printf '%s\n' "$SITE_HTPASSWD" > /tmp/orot.htpasswd
    else
        echo 'A site login secret file is required.' >&2
        exit 1
    fi
    chmod 600 /tmp/orot.htpasswd
fi
unset SITE_HTPASSWD
