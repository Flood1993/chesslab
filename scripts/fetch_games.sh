#!/bin/bash

args=()

args+=(--header "Content-Type: application/x-chess-pgn")
if [[ -n "$LICHESS_API_TOKEN" ]]; then
  echo "Fetching with authentication..."
  args+=(--header "Authorization: Bearer $LICHESS_API_TOKEN")
else
  echo "Fetching without authentication..."
fi

# https://lichess.org/api#tag/games/GET/api/games/user/{username}
curl 'https://lichess.org/api/games/user/GuimotronEnYT?evals=true&perfType=rapid&rated=true' >games.pgn
