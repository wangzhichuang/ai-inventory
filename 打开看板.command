#!/bin/zsh
cd "${0:A:h}" || exit 1
url=http://127.0.0.1:17832
if [[ "$(curl --noproxy '*' -fsS --max-time 2 "$url/api/identity" 2>/dev/null)" == ai-inventory-local ]]; then
  open "$url"
  exit
fi
for py in python3.14 python3.13 python3.12 python3.11 python3 "$HOME"/.local/share/uv/python/cpython-3.1*/bin/python3(N); do
  if "$py" -c 'import tomllib' >/dev/null 2>&1; then
    exec "$py" -B server.py --open
  fi
done
echo '需要 Python 3.11 或更高版本。安装后再双击打开。'
read -k 1
