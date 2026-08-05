#!/bin/zsh
set -eu

hour="$(/bin/date +%H)"
weekday="$(/bin/date +%u)"

# Monday=1 ... Saturday=6. Sunday=7.
if [ "$weekday" -ge 1 ] && [ "$weekday" -le 6 ] && [ "$hour" -ge 8 ] && [ "$hour" -lt 22 ]; then
  /usr/bin/pmset -c sleep 0 displaysleep 5 disksleep 10 powernap 1 tcpkeepalive 1 lowpowermode 0
else
  /usr/bin/pmset -c sleep 15 displaysleep 5 disksleep 10 powernap 1 tcpkeepalive 1 lowpowermode 0
fi

/usr/bin/pmset -b sleep 10 displaysleep 3 disksleep 10 lowpowermode 1
