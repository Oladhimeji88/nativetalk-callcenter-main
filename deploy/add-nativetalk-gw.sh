#!/usr/bin/env bash
# Add the Nativetalk SIP trunk as a FreeSWITCH gateway and register it.
set -uo pipefail
FS=/usr/local/freeswitch
GWDIR="$FS/conf/sip_profiles/external"
mkdir -p "$GWDIR"

# Write gateway with a quoted heredoc so the password (test@!23) is taken literally.
cat > "$GWDIR/nativetalk.xml" <<'XML'
<include>
  <gateway name="nativetalk">
    <param name="username"    value="testcall"/>
    <param name="password"    value="test@!23"/>
    <param name="realm"       value="37.9.63.182"/>
    <param name="proxy"       value="37.9.63.182"/>
    <param name="register"    value="true"/>
    <param name="from-domain" value="37.9.63.182"/>
    <param name="expire-seconds" value="600"/>
    <param name="retry-seconds"  value="30"/>
    <param name="caller-id-in-from" value="true"/>
    <param name="ping"        value="30"/>
  </gateway>
</include>
XML

chown -R freeswitch:freeswitch "$GWDIR"
echo "=== gateway file written ==="
cat "$GWDIR/nativetalk.xml"

echo "=== rescan external profile ==="
"$FS/bin/fs_cli" -H 127.0.0.1 -P 8021 -p 'fsHello_ESL_2026' -x 'sofia profile external rescan' 2>&1
sleep 6
echo "=== gateway status ==="
"$FS/bin/fs_cli" -H 127.0.0.1 -P 8021 -p 'fsHello_ESL_2026' -x 'sofia status gateway nativetalk' 2>&1
echo "GW_DONE"
