#!/bin/sh
set -eu
if [ "${SITE_AUTH_MODE:-off}" != "off" ]; then
    if [ -z "${SITE_HTPASSWD:-}" ]; then
        echo 'SITE_HTPASSWD must be injected from the deployment secret.' >&2
        exit 1
    fi
    umask 077
    printf '%s\n' "$SITE_HTPASSWD" > /tmp/orot.htpasswd
fi
unset SITE_HTPASSWD
