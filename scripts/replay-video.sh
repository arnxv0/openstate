#!/bin/bash
# Replays a video into OPENSTATE as if a phone were streaming it, through the
# frame relay (lib/frame-relay.ts). A dashboard tab must be open on the same
# server, since detection and capture run there.
#
#   scripts/replay-video.sh <video> <observer 01|02> [hold-seconds] [base-url]
#
# Frames are sent at 4 per second; the last one is then held for hold-seconds
# (default 10) so the episode settles, as it would with a phone kept in place.
# Needs ffmpeg. Example, the two fixtures in order:
#
#   scripts/replay-video.sh tests/fixtures/videos/01-remember-this-location.mov 01
#   curl -s -H 'Content-Type: application/json' localhost:3000/api/ask \
#     -d '{"observerId":"01","text":"remember this location","image":"<a frame>"}'
#   scripts/replay-video.sh tests/fixtures/videos/02-recognise-and-take-snack.mov 02
set -euo pipefail

video=${1:?video file}
observer=${2:?observer id, 01 or 02}
hold=${3:-10}
base=${4:-http://localhost:3000}

frames=$(mktemp -d)
trap 'rm -rf "$frames"' EXIT
ffmpeg -v error -i "$video" -vf "fps=4,scale=540:-2" -q:v 6 "$frames/f-%04d.jpg"

post() {
  curl -s -o /dev/null -X POST -H "Content-Type: image/jpeg" --data-binary @"$1" "$base/api/frame/$observer"
}

last=""
for frame in "$frames"/f-*.jpg; do
  post "$frame"
  last=$frame
  sleep 0.22
done
for _ in $(seq 1 $((hold * 4))); do
  post "$last"
  sleep 0.22
done
echo "replayed $(ls "$frames" | wc -l | tr -d ' ') frames as observer $observer, held the last for ${hold}s"
